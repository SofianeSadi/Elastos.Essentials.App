import { Component, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NavController } from '@ionic/angular';
import { TitleBarComponent } from 'src/app/components/titlebar/titlebar.component';
import { TitleBarForegroundMode } from 'src/app/components/titlebar/titlebar.types';
import { Logger } from 'src/app/logger';
import { GlobalNavService } from 'src/app/services/global.nav.service';
import { GlobalSwitchNetworkService } from 'src/app/services/global.switchnetwork.service';
import { ETHTransactionStatus } from 'src/app/wallet/model/evm.types';
import { Transfer } from 'src/app/wallet/services/cointransfer.service';
import { ETHTransactionService } from 'src/app/wallet/services/ethtransaction.service';
import { WalletNetworkService } from 'src/app/wallet/services/network.service';
import { UiService } from 'src/app/wallet/services/ui.service';
import { WalletService } from 'src/app/wallet/services/wallet.service';
import { PacketCosts } from '../../model/packetcosts.model';
import { Packet } from '../../model/packets.model';
import { PacketService } from '../../services/packet.service';
import { PaymentService, PaymentType } from '../../services/payment.service';

@Component({
  selector: 'page-pay',
  templateUrl: 'pay.html',
  styleUrls: ['./pay.scss'],
})
export class PayPage {
  @ViewChild(TitleBarComponent, { static: true }) titleBar: TitleBarComponent;

  // Model
  public fetchingPacketInfo = true;
  private packet: Packet<PacketCosts> = null;
  private packetHash: string;
  //private costs: PacketCosts = null;
  public sendingNativePayment = false;

  constructor(
    public navCtrl: NavController,
    private globalNavService: GlobalNavService,
    private route: ActivatedRoute,
    private router: Router,
    public packetService: PacketService,
    private paymentService: PaymentService,
    private uiService: UiService,
    private globalSwitchNetworkService: GlobalSwitchNetworkService,
    private walletService: WalletService,
    private walletNetworkService: WalletNetworkService,
    private ethTransactionService: ETHTransactionService
  ) {
    route.queryParams.subscribe(params => {
      if (this.router.getCurrentNavigation().extras.state) {
        this.packetHash = this.router.getCurrentNavigation().extras.state.packetHash;
        void this.fetchPacketInfo();
      }
    });
  }

  ionViewWillEnter() {
    this.titleBar.setTitle("Finalize and pay");
    this.titleBar.setBackgroundColor("#f04141");
    this.titleBar.setForegroundMode(TitleBarForegroundMode.LIGHT);
  }

  /**
   * From a packet hash, fetch packet info from the server to know its status and continue the
   * payment where it was stopped
   */
  private async fetchPacketInfo() {
    this.packet = await this.packetService.getPacketInfo(this.packetHash);
    this.fetchingPacketInfo = false;
    console.log("packet", this.packet);
  }

  public packetContainsERC20Tokens(): boolean {
    return !!this.packet.erc20ContractAddress;
  }

  public getNativeTokenSymbol(): string {
    return this.packet.nativeTokenSymbol;
  }

  public isNativePaymentCompleted(): boolean {
    return !!this.packet.paymentStatus.nativeToken;
  }

  /**
   * Note: this method must be called only when the red packet contains ERC20.
   * Otherwise it returns "ELA"
   */
  public getERC20TokenSymbol(): string {
    return this.packet.erc20TokenSymbol;
  }

  public getERC20TokenTotal(): string {
    return this.uiService.getFixedBalance(this.packet.costs.erc20Token.total);
  }

  public getERC20RedPacketValue(): string {
    return this.packet.costs.erc20Token.redPacket.toString();
  }

  public getNativeTokenTotal(): string {
    return this.uiService.getFixedBalance(this.packet.costs.nativeToken.total);
  }

  public getNativeRedPacketValue(): string {
    return this.packet.costs.nativeToken.redPacket.toString();
  }

  public getNativeTokenTxFees(): string {
    return this.uiService.getFixedBalance(this.packet.costs.nativeToken.transactionFees);
  }

  public getNativeTokenServiceFeesUSD(): string {
    return this.packet.costs.nativeToken.standardServiceFeesUSD.toString();
  }

  public getNativeTokenServiceFees(): string {
    return this.uiService.getFixedBalance(this.packet.costs.nativeToken.standardServiceFees);
  }

  /**
   * Directly sends the required native tokens to the service
   */
  public async sendNativeToken() {
    if (this.sendingNativePayment)
      return;

    // Force switch to the right network if we are on the wrong one
    let currentNetwork = this.walletNetworkService.activeNetwork.value;
    let packetNetwork = this.walletNetworkService.getNetworkByChainId(this.packet.chainId);
    if (packetNetwork.getMainChainID() !== currentNetwork.getMainChainID()) {
      let switched = await this.globalSwitchNetworkService.promptSwitchToNetwork(packetNetwork);
      if (!switched) {
        Logger.log("redpackets", "Can't send payment. Wrong network");
        return;
      }
    }

    // Now that we are on the right network, find the network wallet that has the right address
    let evmSubWallet = await this.walletService.findStandardEVMSubWalletByAddress(this.packet.creatorAddress);
    if (!evmSubWallet) {
      Logger.log("redpackets", "Can't find the wallet with which the packet was created. Unable to pay");
      return;
    }

    this.sendingNativePayment = true;

    // TODO: why do we use Number here, not bignumbers ?
    let rawTx = await evmSubWallet.createPaymentTransaction(
      this.packet.paymentAddress,
      this.packet.costs.nativeToken.total.toNumber(),
      "", null, null, -1);

    console.log("Payment rawTx", rawTx);

    const transfer = new Transfer();
    Object.assign(transfer, {
      masterWalletId: evmSubWallet.masterWallet.id,
      subWalletId: evmSubWallet.id,
      rawTransaction: rawTx,
      action: null,
      intentId: null
    });

    try {
      // Listen to transaction events in order to catch the published transaction hash.
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      let txStatusSub = this.ethTransactionService.ethTransactionStatus.subscribe(async txStatus => {
        // Make sure we are receiving a status for our current operation, not for something else
        // Note: this check if far from being robust, let's assume for now that there is only one on going
        // transaction at a time... Can't do much better over the existing mechanism.
        if (txStatus.chainId === evmSubWallet.id) {
          if (txStatus.txId && !this.paymentService.getPaymentByTransactionHash(txStatus.txId)) {
            // Transaction hash received. Save it locally to be able to retry notifying the back-end
            // later if needed (in case the backend was not accessible right now, or crashed, etc)
            Logger.log("redpackets", "Transaction hash received for the payment. Creating a payment entry");
            await this.paymentService.createPayment(this.packet.hash, txStatus.txId, PaymentType.NATIVE_TOKEN);
          }

          if (txStatus.status === ETHTransactionStatus.PACKED) {
            // Notify the backend about this payment, so it can update the packet status
            Logger.log("redpackets", "Transaction has been packed on chain. Telling this to the backend");
            let confirmedPaymentStatus = await this.paymentService.notifyServiceOfPayment(this.packet.hash, txStatus.txId, this.packet.tokenType);
            if (confirmedPaymentStatus) {
              // Payment is confirmed by the backend
              this.packet.paymentStatus.nativeToken = confirmedPaymentStatus;
            }
            else {
              // Payment could not be confirmed by the backend
              // TODO
            }

            this.sendingNativePayment = false;

            // Stop listening, we got everything we needed
            txStatusSub.unsubscribe();
          }
        }
      });
      await this.ethTransactionService.publishTransaction(evmSubWallet, rawTx, transfer, true);
    }
    catch (err) {
      Logger.error('redpackets', 'publishTransaction error:', err)
    }

    console.log("after payment");
  }

  /**
   * Directly sends the required native ERC20 tokens to the service
   */
  public sendERC20Tokens() {

  }

  private requestToCheckPayment() {
    void this.packetService.requestToCheckPayment(this.packet.hash);
  }
}

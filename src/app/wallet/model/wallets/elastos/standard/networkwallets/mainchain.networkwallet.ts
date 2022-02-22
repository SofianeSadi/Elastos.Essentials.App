import { Logger } from "src/app/logger";
import { jsToSpvWalletId, SPVService } from "src/app/wallet/services/spv.service";
import { StandardCoinName } from "../../../../coin";
import { AnyNetwork } from "../../../../networks/network";
import { ElastosMainChainTransactionProvider } from "../../../../tx-providers/elastos/elastos.mainchain.tx.provider";
import { TransactionProvider } from "../../../../tx-providers/transaction.provider";
import { StandardMasterWallet } from "../../../masterwallet";
import { WalletAddressInfo } from "../../../networkwallet";
import { WalletHelper } from "../../wallet.helper";
import { ElastosEVMSubWallet } from "../subwallets/elastos.evm.subwallet";
import { MainChainSubWallet } from "../subwallets/mainchain.subwallet";
import { ElastosStandardNetworkWallet } from "./elastos.networkwallet";

export class ElastosMainChainStandardNetworkWallet extends ElastosStandardNetworkWallet {
  constructor(masterWallet: StandardMasterWallet, network: AnyNetwork) {
    super(masterWallet, network, "ELA");
  }

  protected createTransactionDiscoveryProvider(): TransactionProvider<any> {
    return new ElastosMainChainTransactionProvider(this);
  }

  protected async prepareStandardSubWallets(): Promise<void> {
    try {
      await SPVService.instance.createSubWallet(jsToSpvWalletId(this.masterWallet.id), StandardCoinName.ELA);
      this.subWallets[StandardCoinName.ELA] = new MainChainSubWallet(this);
      await this.subWallets[StandardCoinName.ELA].initialize();
    }
    catch (err) {
      Logger.error("wallet", "Can not Create Elastos main chain standard subwallets ", err);
    }
  }

  public async getAddresses(): Promise<WalletAddressInfo[]> {
    let addresses = [];

    // No ELA when imported by private key.
    if (this.subWallets[StandardCoinName.ELA]) {
      addresses.push({
        title: this.subWallets[StandardCoinName.ELA].getFriendlyName(),
        address: await this.subWallets[StandardCoinName.ELA].createAddress()
      });
    }

    return addresses;
  }

  public getMainEvmSubWallet(): ElastosEVMSubWallet {
    return null;
  }

  /**
   * Tells whether this wallet currently has many addresses in use or not.
   *
   * TODO: move to the standard subwallet (ela mainchain), make more generic
   */
  public async multipleAddressesInUse(): Promise<boolean> {
    let mainChainSubWallet: MainChainSubWallet = this.subWallets[StandardCoinName.ELA] as MainChainSubWallet;
    let txListsInternal = await WalletHelper.getTransactionByAddress(mainChainSubWallet, true, 2);
    if (txListsInternal.length > 1) {
      return true;
    }
    let txListsExternal = await WalletHelper.getTransactionByAddress(mainChainSubWallet, false, 2);
    if (txListsExternal.length > 1) {
      return true;
    }

    return false;
  }

  public getDisplayTokenName(): string {
    return 'ELA';
  }

  public getAverageBlocktime(): number {
    return 120;
  }
}
/*
export class ElastosMainChainStandardNetworkWallet extends ElastosMainChainNetworkWallet {
} */
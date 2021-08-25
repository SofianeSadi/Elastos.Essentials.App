import { StandardSubWalletBuilder } from "../standardsubwalletbuilder";
import { MasterWallet } from "../masterwallet";
import { NetworkWallet } from "../NetworkWallet";
import { HECOChainSubWallet } from "./heco.subwallet";
import { StandardCoinName } from "../../coin";
import { ElastosEVMSubWallet } from "../elastos/elastos.evm.subwallet";
import { MainchainSubWallet } from "../elastos/mainchain.subwallet";
import { StandardSubWallet } from "../standard.subwallet";
import { Network } from "../../networks/network";

export class HecoNetworkWallet extends NetworkWallet {
  constructor(masterWallet: MasterWallet, network: Network) {
    super(masterWallet, network);
  }

  protected async prepareStandardSubWallets(): Promise<void> {
    this.subWallets[StandardCoinName.ETHHECO] = new HECOChainSubWallet(this);
    await this.masterWallet.walletManager.spvBridge.createSubWallet(this.masterWallet.id, StandardCoinName.ETHHECO);
  }
}
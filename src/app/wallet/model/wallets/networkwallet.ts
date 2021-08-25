import { SubWallet, SerializedSubWallet  } from './subwallet';
import { WalletService } from '../../services/wallet.service';
import { StandardSubWallet } from './standard.subwallet';
import { Coin, CoinID, CoinType, ERC20Coin, StandardCoinName } from '../coin';
import BigNumber from 'bignumber.js';
import { Config } from '../../config/Config';
import { ElastosEVMSubWallet } from './elastos/elastos.evm.subwallet';
import { Logger } from 'src/app/logger';
import { NFT, NFTType } from '../nfts/nft';
import { MasterWallet } from './masterwallet';
import { ERC20TokenInfo } from '../evm.types';
import { SubWalletBuilder } from './subwalletbuilder';
import { LocalStorage } from '../../services/storage.service';
import { Network } from '../networks/network';

export class ExtendedNetworkWalletInfo {
    subWallets: SerializedSubWallet[] = [];
}

/**
 * A network wallet is an instance of a master wallet (one root key) for a
 * given network (elastos, heco, etc).
 */
export abstract class NetworkWallet {
    public id: string = null;

    public subWallets: {
        [k: string]: SubWallet
    } = {};

    public nfts: NFT[] = [];

    constructor(
        public masterWallet: MasterWallet,
        public network: Network
    ) {
        this.id = masterWallet.id;
    }

    public async initialize(): Promise<void> {
        await this.prepareStandardSubWallets();
        await this.populateWithExtendedInfo(await LocalStorage.instance.getExtendedNetworWalletInfo(this.id, this.network.key));
    }

    public getDisplayBalance(): BigNumber {
        // Sum all subwallets balances to get the master wallet total balance
        // Only standard ELA wallets are summed up as ERC20 wallets amounts use their own currency
        // and canno't be stacked on top of ELA as we don't have a exchange rate for now.
        let balance = new BigNumber(0);
        for (let subWallet of Object.values(this.subWallets)) {
            if (subWallet instanceof StandardSubWallet) {
              if (!subWallet.balance.isNaN()) {
                balance = balance.plus(subWallet.balance);
              }
            }
        }

        return balance.dividedBy(Config.SELAAsBigNumber);
    }

    /**
     * Update balance and transaction list.
     */
    public async update() {
        for (let subWallet of Object.values(this.subWallets)) {
            await subWallet.update();
        }
    }

    public getSubWalletBalance(coinId: CoinID): BigNumber {
        console.log("getSubWalletBalance", coinId, this.subWallets)
        return this.subWallets[coinId].balance;
    }

    public hasSubWallet(coinId: CoinID): boolean {
        return coinId in this.subWallets;
    }

    /**
     * Returns the list of all subwallets except the excluded one.
     */
    public subWalletsWithExcludedCoin(excludedCoinName: StandardCoinName, type: CoinType = null): SubWallet[] {
        // Hide the id chain, do not use the id chain any more.
        return Object.values(this.subWallets).filter((sw)=>{
            return (sw.id !== excludedCoinName) && (sw.id !== StandardCoinName.IDChain) && (type !== null ? sw.type === type : true);
        });
    }

    /**
     * Each inheriting network wallet must create its standard subwallets to the SPVSDK if
     * not yet created, and push instances of those subwallets so we can store them.
     */
    protected abstract prepareStandardSubWallets(): Promise<void>;

    /**
     * Adds a new subwallet to this network wallet, based on a given coin type.
     */
    public async createNonStandardSubWallet(coin: Coin) {
        try {
          this.subWallets[coin.getID()] = await SubWalletBuilder.newFromCoin(this, coin);

          Logger.log("wallet", "Created subwallet with id "+coin.getID()+" for wallet "+this.id);

          await this.save();
        }
        catch (err) {
          if (err.code !== 20001) {// 20001: Unsupported subwallet in some test network.
            throw err;
          }
        }
    }

    public removeNonStandardSubWallet(coin: Coin) {
        console.log("TODO - removeNonStandardSubWallet not implemented");
    }

    /**
     * Convenient method to access subwallets as an array alphabetically.
     */
    public getSubWallets(): SubWallet[] {
        return Object.values(this.subWallets).sort((a, b) => {
          if (a.type == CoinType.STANDARD && (b.type == CoinType.STANDARD)) return 0;
          if (a.type == CoinType.STANDARD) return -1;
          if (b.type == CoinType.STANDARD) return 1;
          return a.getFriendlyName() > b.getFriendlyName() ? 1 : -1}
          );
    }

    public getSubWallet(id: CoinID): SubWallet {
        return this.subWallets[id];
    }

    /**
     * Returns the list of all subwallets by CoinType
     */
    public getSubWalletsByType(type: CoinType): SubWallet[] {
        return Object.values(this.subWallets).filter((sw)=>{
            return (sw.type === type);
        });
    }

    /**
     * Get all the tokens (ERC 20, 721, 1155), and create the subwallet.
     */
    public async updateERCTokenList(activeNetworkTemplate: string) {
        if (!this.subWallets[StandardCoinName.ETHSC]) {
            Logger.log("wallet", 'updateERC20TokenList no ETHSC');
            return;
        }

        const ercTokenList = await (this.subWallets[StandardCoinName.ETHSC] as ElastosEVMSubWallet).getERC20TokenList();
        if (ercTokenList == null) return;

        // For each ERC token discovered by the wallet SDK, we check its type and handle it.
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        ercTokenList.forEach(async (token: ERC20TokenInfo) => {
            if (token.type === "ERC-20") {
                if (token.symbol && token.name) {
                    if (!this.subWallets[token.symbol] && !this.masterWallet.coinService.isCoinDeleted(token.contractAddress)) {
                        try {
                            // Check if we already know this token globally. If so, we add it as a new subwallet
                            // to this master wallet. Otherwise we add the new token to the global list first then
                            // add a subwallet as well.
                            const erc20Coin = this.masterWallet.coinService.getERC20CoinByContractAddress(token.contractAddress);
                            if (erc20Coin) {
                                await this.createNonStandardSubWallet(erc20Coin);
                            } else {
                                const newCoin = new ERC20Coin(token.symbol, token.symbol, token.name, token.contractAddress, activeNetworkTemplate, true);
                                await this.masterWallet.coinService.addCustomERC20Coin(newCoin, WalletService.instance.getNetworkWalletsList());
                            }
                        } catch (e) {
                            Logger.log("wallet", 'updateERC20TokenList exception:', e);
                        }
                    }
                } else {
                    Logger.warn('wallet', 'Token has no name or symbol:', token);
                }
            }
            else if (token.type === "ERC-721") {
                if (!this.containsNFT(token.contractAddress)) {
                    await this.createNFT(NFTType.ERC721, token.contractAddress, Number.parseInt(token.balance));
                }
            }
            else if (token.type === "ERC-1155") {
                Logger.warn('wallet', 'ERC1155 NFTs not yet implemented', token);
            }
            else {
                Logger.warn('wallet', 'Unhandled token type:', token);
            }
        });
    }

    /**
     * Tells if this master wallet contains a NFT information, based on the NFT's contract address.
     */
    public containsNFT(contractAddress: string): boolean {
        return this.nfts.findIndex(nft => nft.contractAddress === contractAddress) !== -1;
    }

    public async createNFT(nftType: NFTType, contractAddress: string, balance: number): Promise<void> {
        let resolvedInfo = await this.masterWallet.erc721Service.getCoinInfo(contractAddress);
        if (resolvedInfo) {
          let nft = new NFT(nftType, contractAddress, balance);
          nft.setResolvedInfo(resolvedInfo);
          this.nfts.push(nft);

          await this.masterWallet.save();
        }
    }

    public getNFTs(): NFT[] {
        return this.nfts;
    }

    public getNFTByAddress(contractAddress: string): NFT {
        return this.nfts.find(n => n.contractAddress === contractAddress);
    }

    /**
     * Retrieves latest information about assets on chain and update the local cache and model.
     */
    public async refreshNFTAssets(nft: NFT): Promise<void> {
        let accountAddress = await this.getSubWallet(StandardCoinName.ETHSC).createAddress();
        if (nft.type == NFTType.ERC721) {
            let assets = await this.masterWallet.erc721Service.fetchAllAssets(accountAddress, nft.contractAddress);
            console.log("ASSETS", assets);

            nft.assets = assets; // can be null (couldn't fetch assets) or empty (0 assets)
        }
    }

    /**
     * Save network wallet info to permanent storage
     */
     public async save() {
        const extendedInfo = this.getExtendedWalletInfo();
        Logger.log('wallet', "Saving network wallet extended info", this, extendedInfo);

        await LocalStorage.instance.setExtendedNetworkWalletInfo(this.id, this.network.key, extendedInfo);
    }

    public getExtendedWalletInfo(): ExtendedNetworkWalletInfo {
        let extendedInfo = new ExtendedNetworkWalletInfo();

        extendedInfo.subWallets = this.getSubWallets().map(subwallet => SerializedSubWallet.fromSubWallet(subwallet));

        return extendedInfo;
    }

    /**
     * Appends extended info from the local storage to this wallet model.
     * This includes everything the SPV plugin could not save and that we saved in our local
     * storage instead.
     */
    public populateWithExtendedInfo(extendedInfo: ExtendedNetworkWalletInfo) {
        Logger.log("wallet", "Populating network master wallet with extended info", this.id, extendedInfo);

        // In case of newly created wallet we don't have extended info from local storagd yet,
        // which is normal.
        if (extendedInfo) {
            for (let serializedSubWallet of extendedInfo.subWallets) {
                let subWallet = SubWalletBuilder.newFromSerializedSubWallet(this, serializedSubWallet);
                if (subWallet) {
                    this.subWallets[serializedSubWallet.id] = subWallet;
                }
            }

            /* TODO this.nfts = [];
            if (extendedInfo.nfts) {
                for (let serializedNFT of extendedInfo.nfts) {
                    let nft: NFT = NFT.parse(serializedNFT);
                    if (nft) {
                        this.nfts.push(nft);
                    }
                }
            } */
        }

        Logger.log("wallet", "Populated master wallet:", this);
    }
}
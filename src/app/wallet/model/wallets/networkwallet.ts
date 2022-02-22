import BigNumber from 'bignumber.js';
import moment from 'moment';
import { Subject } from 'rxjs';
import { Logger } from 'src/app/logger';
import { GlobalNetworksService } from 'src/app/services/global.networks.service';
import { CurrencyService } from '../../services/currency.service';
import { DefiService, StakingData } from '../../services/evm/defi.service';
import { ERC1155Service } from '../../services/evm/erc1155.service';
import { ERC721Service } from '../../services/evm/erc721.service';
import { LocalStorage } from '../../services/storage.service';
import { Coin, CoinID, CoinType } from '../coin';
import { AnyNetwork } from '../networks/network';
import { NFT, NFTType, SerializedNFT } from '../nfts/nft';
import { TransactionProvider } from '../tx-providers/transaction.provider';
import { WalletNetworkOptions } from '../wallet.types';
import { WalletSortType } from '../walletaccount';
import { StandardEVMSubWallet } from './evm.subwallet';
import { MasterWallet } from './masterwallet';
import { AnySubWallet, SerializedSubWallet } from './subwallet';
import { SubWalletBuilder } from './subwalletbuilder';

export class ExtendedNetworkWalletInfo {
    /** List of serialized subwallets added earlier to this network wallet */
    subWallets: SerializedSubWallet[] = [];
    /** List of serialized NFTs added earlier to this master wallet */
    nfts: SerializedNFT[] = []; // TODO: Save each NFT's list of tokens in another storage item.
}

export type StakingInfo = {
    timestamp: number;
    stakingData: StakingData[];
}

export type WalletAddressInfo = {
    title: string;
    address: string;
}

/**
 * A network wallet is an instance of a master wallet (one root key) for a
 * given network (elastos, heco, etc).
 */
export abstract class NetworkWallet<MasterWalletType extends MasterWallet, WalletNetworkOptionsType extends WalletNetworkOptions> {
    public id: string = null;
    protected transactionDiscoveryProvider: TransactionProvider<any> = null;
    private initializationComplete = false;

    public subWallets: {
        [k: string]: AnySubWallet
    } = {};

    public nfts: NFT[] = [];

    public subWalletsListChange = new Subject<AnySubWallet>(); // Subwallet added or created
    public stakedAssetsUpdate = new Subject<StakingData[]>();

    private fetchMainTokenTimer: any = null;
    private fetchStakingAssetTimer: any = null;

    private stakingAssetsID = '';
    private stakingInfo: StakingInfo = null;

    constructor(
        public masterWallet: MasterWalletType,
        public network: AnyNetwork,
        public displayToken: string // Ex: "HT", "BSC"
    ) {
        this.id = masterWallet.id;

        this.transactionDiscoveryProvider = this.createTransactionDiscoveryProvider();
    }

    public async initialize(): Promise<void> {
        // Prepare standard coin(s)
        await this.prepareStandardSubWallets();

        // First time we use this wallet? Add some default useful ERC20 coins
        await this.checkFirstTimeUseAddCoins();

        // Prepare ERC20, NFT subwallets and other info
        await this.populateWithExtendedInfo(await LocalStorage.instance.getExtendedNetworWalletInfo(this.id, GlobalNetworksService.instance.activeNetworkTemplate.value, this.network.key));

        // There is no EVMSubwallet in BTCNetworkWallet.
        if (this.getMainEvmSubWallet()) {
            this.stakingAssetsID = await this.getUniqueIdentifierOnStake();
            await this.loadStakingAssets();
        }

        this.initializationComplete = true;
    }

    protected abstract createTransactionDiscoveryProvider(): TransactionProvider<any>;

    /**
     * Starts network wallet and subwallets updates in background.
     * All the initializations here are not mandatory during initializations and can deliver
     * asynchronous content at any time.
     */
    public startBackgroundUpdates(): Promise<void> {
        for (let subWallet of this.getSubWallets()) {
            void subWallet.startBackgroundUpdates();
        }

        void this.fetchAndRearmMainTokenValue();

        // There is no EVMSubwallet in BTCNetworkWallet.
        if (this.getMainEvmSubWallet()) {
            void this.fetchAndRearmStakingAssets();
        }

        this.getTransactionDiscoveryProvider().start();

        return;
    }

    /**
     * Stops network wallet and subwallets updates that are running in background.
     * This method call should be awaited to make sure every running task is stopped before
     * switching to another user or network for instance.
     */
    public async stopBackgroundUpdates(): Promise<void> {
        for (let subWallet of this.getSubWallets()) {
            void subWallet.stopBackgroundUpdates();
        }

        clearTimeout(this.fetchMainTokenTimer);
        clearTimeout(this.fetchStakingAssetTimer);

        await this.getTransactionDiscoveryProvider().stop();
    }

    private async fetchAndRearmMainTokenValue(): Promise<void> {
        await this.fetchMainTokenValue();

        this.fetchMainTokenTimer = setTimeout(() => {
            void this.fetchAndRearmMainTokenValue();
        }, 30000);
    }

    private async fetchMainTokenValue(): Promise<void> {
        await CurrencyService.instance.fetchMainTokenValue(new BigNumber(1), this.network, 'USD');
    }

    // Do not auto refresh.
    // If we have never fetched the api, the first time we fetch automatically
    private async fetchAndRearmStakingAssets(): Promise<void> {
        if (!this.stakingInfo) {
            await this.fetchStakingAssets();
        }

        // this.fetchStakingAssetTimer = setTimeout(() => {
        //     void this.fetchAndRearmStakingAssets();
        // }, 300000); // 5 minutes
    }

    /**
     * If this is the first time we use this network wallet (no network info exists), then we add
     * some default built in ERC20 coins for convenience.
     */
    private async checkFirstTimeUseAddCoins(): Promise<void> {
        let activeNetworkTemplate = GlobalNetworksService.instance.activeNetworkTemplate.value;
        let existingExtendedInfo = await LocalStorage.instance.getExtendedNetworWalletInfo(this.id, activeNetworkTemplate, this.network.key);
        if (existingExtendedInfo)
            return; // Not the first time, don't re-add coins that user may have disabled.

        let builtInCoins = this.network.getBuiltInERC20Coins();
        for (let i = 0; i < builtInCoins.length; i++) {
            let coin = builtInCoins[i];
            if (coin.initiallyShowInWallet) {
                await this.createNonStandardSubWallet(coin);
            }
        }
    }

    /**
     * Valuation of one native token in USD
     */
    /* public nativeTokenUSDValue(): BigNumber {

    } */

    private getDisplayBalanceInCurrency(currencySymbol: string): BigNumber {
        if (!this.initializationComplete)
            return new BigNumber(0);

        let canGetBalance = false;
        let usdBalance = new BigNumber(0);
        for (let subWallet of Object.values(this.subWallets)) {
            if (!subWallet.getBalance().isNaN()) {
                canGetBalance = true;
                let subWalletUSDBalance = subWallet.getUSDBalance();
                usdBalance = usdBalance.plus(subWalletUSDBalance);
            }
        }

        // Staking assets
        if (this.stakingInfo) {
            for (let stakingAsset of Object.values(this.stakingInfo.stakingData)) {
                if (stakingAsset.amountUSD) {
                    canGetBalance = true;
                    usdBalance = usdBalance.plus(stakingAsset.amountUSD);
                }
            }
        }

        if (!canGetBalance) {
            return new BigNumber(NaN);
        }

        // Convert USD balance to currency (ex: CNY) balance
        return CurrencyService.instance.usdToCurrencyAmount(usdBalance, currencySymbol);
    }

    /**
     * This methods returns the whole wallet valuation in number of NATIVE TOKEN.
     * To get this, we sum all subwallets balances USD value to get the master wallet total balance.
     * Then convert back to native currency value
     */
    public getDisplayBalance(): BigNumber {
        let usdBalance = this.getDisplayBalanceInCurrency('USD');

        // Convert USD balance back to native token
        let nativeTokenUSDPrice = CurrencyService.instance.getMainTokenValue(new BigNumber(1), this.network, 'USD');
        if (nativeTokenUSDPrice)
            return usdBalance.dividedBy(nativeTokenUSDPrice);
        else
            return new BigNumber(0);
    }

    // The higher the price, the more decimal places.
    public getDecimalPlaces() {
        let decimalPlaces = 3;
        let nativeTokenUSDPrice = CurrencyService.instance.getMainTokenValue(new BigNumber(1), this.network, 'USD');
        if (nativeTokenUSDPrice) {
            const digit = nativeTokenUSDPrice.dividedToIntegerBy(1).toString().length;
            decimalPlaces = digit < 3 ? 3 : digit + 1;
        }
        return decimalPlaces;
    }

    /**
     * Returns the whole balance balance, for the active currency.
     */
    public getDisplayBalanceInActiveCurrency(): BigNumber {
        return this.getDisplayBalanceInCurrency(CurrencyService.instance.selectedCurrency.symbol);
    }

    public abstract getDisplayTokenName(): string;

    public abstract getAverageBlocktime(): number;

    /**
     * Update balance and transaction list.
     */
    public async update() {
        for (let subWallet of Object.values(this.subWallets)) {
            await subWallet.update();
        }
    }

    /**
     * Update balance.
     */
    public async updateBalance() {
        for (let subWallet of Object.values(this.subWallets)) {
            await subWallet.updateBalance();
        }
    }

    public getSubWalletBalance(coinId: CoinID): BigNumber {
        Logger.log("wallet", "getSubWalletBalance", coinId, this.subWallets)
        return this.subWallets[coinId].getRawBalance();
    }

    public hasSubWallet(coinId: CoinID): boolean {
        return coinId in this.subWallets;
    }

    /**
     * Returns the list of all subwallets except the excluded one.
     */
    public subWalletsWithExcludedCoin(excludedCoinName: CoinID, type: CoinType = null): AnySubWallet[] {
        // Hide the id chain, do not use the id chain any more.
        return Object.values(this.subWallets).filter((sw) => {
            return (sw.id !== excludedCoinName) && (type !== null ? sw.type === type : true);
        });
    }

    /**
     * Make standard subwallets ready, when the network wallet initializes.
     */
    protected abstract prepareStandardSubWallets(): Promise<void>;

    public abstract getAddresses(): Promise<WalletAddressInfo[]>;

    /**
     * Returns the main subwallet inside this network wallet, responsible for refreshing the list of
     * ERC20 tokens, NFTs, etc. For elastos, this is the ESC sidechain (no EID support for now).
     * 
     * TODO: MOVE TO EVM NETWORK WALLETS ONLY
     */
    public abstract getMainEvmSubWallet(): StandardEVMSubWallet<WalletNetworkOptionsType>;

    /**
     * Adds a new subwallet to this network wallet, based on a given coin type.
     */
    public async createNonStandardSubWallet(coin: Coin): Promise<void> {
        try {
            let newSubWallet = await SubWalletBuilder.newFromCoin(this, coin);
            this.subWallets[coin.getID()] = newSubWallet;

            Logger.log("wallet", "Created subwallet with id " + coin.getID() + " for wallet " + this.id);

            await this.save();

            this.subWalletsListChange.next(newSubWallet);
        }
        catch (err) {
            if (err.code !== 20001) {// 20001: Unsupported subwallet in some test network.
                throw err;
            }
        }
    }

    public async removeNonStandardSubWallet(coin: Coin): Promise<void> {
        Logger.log("wallet", "Removing subwallet with id " + coin.getID() + " from wallet " + this.id);

        let deletedSubWallet = this.subWallets[coin.getID()];
        delete this.subWallets[coin.getID()];

        await this.save();

        this.subWalletsListChange.next(deletedSubWallet);
    }

    /**
     * Convenient method to access subwallets as an array alphabetically.
     */
    public getSubWallets(sortType: WalletSortType = WalletSortType.NAME): AnySubWallet[] {
        return Object.values(this.subWallets).sort((a, b) => {
            if (a.type == CoinType.STANDARD && (b.type == CoinType.STANDARD)) return 0;
            if (a.type == CoinType.STANDARD) return -1;
            if (b.type == CoinType.STANDARD) return 1;
            // sort by balance or alphabetical
            if (sortType === WalletSortType.NAME) {
                return a.getDisplayTokenName() > b.getDisplayTokenName() ? 1 : -1
            } else {
                let aBalance = a.getUSDBalance();
                let bBalance = b.getUSDBalance();
                if (aBalance.isEqualTo(bBalance)) {
                    return a.getDisplayTokenName() > b.getDisplayTokenName() ? 1 : -1
                } else return aBalance.gt(bBalance) ? -1 : 1;
            }
        }
        );
    }

    public getSubWallet(id: CoinID): AnySubWallet {
        return this.subWallets[id];
    }

    /**
     * Returns the list of all subwallets by CoinType
     */
    public getSubWalletsByType(type: CoinType): AnySubWallet[] {
        return Object.values(this.subWallets).filter((sw) => {
            return (sw.type === type);
        });
    }

    /**
     * Tells if this master wallet contains a NFT information, based on the NFT's contract address.
     * 
     * TODO: MOVE TO EVM NETWORK WALLETS ONLY
     */
    public containsNFT(contractAddress: string): boolean {
        return this.nfts.findIndex(nft => nft.contractAddress === contractAddress) !== -1;
    }

    /**
     * TODO: MOVE TO EVM NETWORK WALLETS ONLY
     */
    public async createNFT(nftType: NFTType, contractAddress: string, balance: number): Promise<void> {
        if (nftType === NFTType.ERC721) {
            let resolvedInfo = await ERC721Service.instance.getCoinInfo(contractAddress);
            if (resolvedInfo) {
                let nft = new NFT(nftType, contractAddress, balance);
                nft.setResolvedInfo(resolvedInfo);
                this.nfts.push(nft);

                await this.save();
            }
        }
        else if (nftType === NFTType.ERC1155) {
            let resolvedInfo = await ERC1155Service.instance.getCoinInfo(contractAddress);
            if (resolvedInfo) {
                let nft = new NFT(nftType, contractAddress, balance);
                nft.setResolvedInfo(resolvedInfo);
                this.nfts.push(nft);

                await this.save();
            }
        }
    }

    /**
     * TODO: MOVE TO EVM NETWORK WALLETS ONLY
     */
    public getNFTs(): NFT[] {
        return this.nfts;
    }

    /**
     * TODO: MOVE TO EVM NETWORK WALLETS ONLY
     */
    public getNFTByAddress(contractAddress: string): NFT {
        return this.nfts.find(n => n.contractAddress === contractAddress);
    }

    /**
     * Retrieves latest information about assets on chain and update the local cache and model.
     * 
     * TODO: MOVE TO EVM NETWORK WALLETS ONLY
     */
    public async refreshNFTAssets(nft: NFT): Promise<void> {
        let accountAddress = await this.getMainEvmSubWallet().createAddress();
        if (nft.type == NFTType.ERC721) {
            let assets = await ERC721Service.instance.fetchAllAssets(accountAddress, nft.contractAddress);
            nft.assets = assets; // can be null (couldn't fetch assets) or empty (0 assets)
        }
        else if (nft.type == NFTType.ERC1155) {
            let assets = await ERC1155Service.instance.fetchAllAssets(accountAddress, nft.contractAddress);
            nft.assets = assets; // can be null (couldn't fetch assets) or empty (0 assets)
        }
    }

    /**
     * Save network wallet info to permanent storage
     */
    public async save() {
        const extendedInfo = this.getExtendedWalletInfo();
        Logger.log('wallet', "Saving network wallet extended info", this, extendedInfo);

        await LocalStorage.instance.setExtendedNetworkWalletInfo(this.id, GlobalNetworksService.instance.activeNetworkTemplate.value, this.network.key, extendedInfo);
    }

    public getExtendedWalletInfo(): ExtendedNetworkWalletInfo {
        let extendedInfo = new ExtendedNetworkWalletInfo();

        extendedInfo.subWallets = this.getSubWallets().map(subwallet => SerializedSubWallet.fromSubWallet(subwallet));

        for (let nft of this.nfts) {
            extendedInfo.nfts.push(nft.toSerializedNFT());
        }

        return extendedInfo;
    }

    /**
     * Appends extended info from the local storage to this wallet model.
     * This includes everything the SPV plugin could not save and that we saved in our local
     * storage instead.
     */
    public async populateWithExtendedInfo(extendedInfo: ExtendedNetworkWalletInfo): Promise<void> {
        //Logger.log("wallet", "Populating network master wallet with extended info", this.id, extendedInfo);

        // In case of newly created wallet we don't have extended info from local storage yet,
        // which is normal.
        if (extendedInfo) {
            let needUpdateExtendedInfo = false;

            for (let serializedSubWallet of extendedInfo.subWallets) {
                // NOTE: for now, we save the standard subwallets but we don't restore them from extended info
                // as they are always rebuilt by default by the network wallet. Later this COULD be a problem
                // if we want to save some information about those standard subwallets, in extended infos.
                if (serializedSubWallet.type !== "STANDARD") {
                    let subWallet = await SubWalletBuilder.newFromSerializedSubWallet(this, serializedSubWallet);
                    if (subWallet) {
                        this.subWallets[serializedSubWallet.id] = subWallet;
                    } else {
                        // Need to update extendedInfo to delete the invalid subwallet.
                        // (The subWallets use the token name as id in the old version(< 2.3.0))
                        needUpdateExtendedInfo = true;
                    }
                }
            }

            this.nfts = [];
            // Legacy support: normally, no need to check if the network supports NFTs as there would be no NFT
            // founds earlier, but keep it happens (elastos network split) so keep this check.
            if (this.network.supportsERCNFTs()) {
                if (extendedInfo.nfts) {
                    for (let serializedNFT of extendedInfo.nfts) {
                        let nft: NFT = NFT.parse(serializedNFT);
                        if (nft) {
                            this.nfts.push(nft);
                        }
                    }
                }
            }

            if (needUpdateExtendedInfo) {
                void this.save()
            }
        }
    }

    public getTransactionDiscoveryProvider(): TransactionProvider<any> {
        return this.transactionDiscoveryProvider;
    }

    // Stake assets
    private async getUniqueIdentifierOnStake() {
        let tokenAddress = await this.getMainEvmSubWallet().getTokenAddress();
        let chainId = this.network.getMainChainID();
        return 'stakingassets-' + tokenAddress + '-' + chainId + '-' + this.masterWallet.id;
    }

    private async loadStakingAssets() {
        this.stakingInfo = await LocalStorage.instance.get(this.stakingAssetsID);
        return this.stakingInfo;
    }

    private async saveStakingAssets(stakingInfo: StakingInfo) {
        await LocalStorage.instance.set(this.stakingAssetsID, stakingInfo);
    }

    // In order to reduce resource consumption, the update interval is 10 minutes.
    public async fetchStakingAssets() {
        const tenMinutesago = moment().add(-10, 'minutes').valueOf();
        if (!this.stakingInfo || (this.stakingInfo.timestamp < tenMinutesago)) {
            let tokenAddress = await this.getMainEvmSubWallet().getTokenAddress();
            let chainId = this.network.getMainChainID();
            let stakingData = await DefiService.instance.getStakingAssets(tokenAddress, chainId);
            if (stakingData) {
                stakingData.sort((a, b) => {
                    if (b.amountUSD > a.amountUSD) return 1;
                    else return -1;
                })
                this.stakingInfo = {
                    timestamp: moment().valueOf(),
                    stakingData: stakingData
                }
                await this.saveStakingAssets(this.stakingInfo);
                this.stakedAssetsUpdate.next(this.stakingInfo.stakingData);
            }
        }
        return this.stakingInfo;
    }

    public getStakingAssets() {
        if (this.stakingInfo) {
            return this.stakingInfo.stakingData;
        }
        else return [];
    }

    public getNetworkOptions(): WalletNetworkOptionsType {
        return this.masterWallet.networkOptions.find(no => no.network === this.network.key) as WalletNetworkOptionsType;
    }
}

export abstract class AnyNetworkWallet extends NetworkWallet<MasterWallet, any> { }
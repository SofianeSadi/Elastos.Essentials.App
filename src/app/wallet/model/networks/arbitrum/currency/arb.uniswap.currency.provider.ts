import { MAINNET_TEMPLATE } from "src/app/services/global.networks.service";
import { ERC20Coin } from "../../../coin";
import { UniswapCurrencyProvider } from "../../uniswap.currencyprovider";

export class ArbitrumMainnetUniswapCurrencyProvider extends UniswapCurrencyProvider {
  private referenceUSDCoin = new ERC20Coin("USDT", "USDT", "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", 6, MAINNET_TEMPLATE, false, true);
  private wrappedNativeCoin = new ERC20Coin("WETH", "Wrapped ETH", "0x82af49447d8a07e3bd95bd0d56f35241523fbab1", 18, MAINNET_TEMPLATE, false, true);

  public getFactoryAddress(): string {
    return "0xc35DADB65012eC5796536bD9864eD8773aBc74C4"; // Sushiswap V2 factory
  }

  public getFactoryInitCodeHash(): string {
    return "0xe18a34eb0e04b04f7a0ac29a6e80748dca96319b42c54d679cb821dca90c6303"; // Sushiswap V2 factory init code hash
  }

  public getReferenceUSDCoin(): ERC20Coin {
    return this.referenceUSDCoin;
  }

  public getWrappedNativeCoin(): ERC20Coin {
    return this.wrappedNativeCoin;
  }
}
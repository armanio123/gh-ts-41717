// @ts-nocheck
import { Candle, Trade, AggregatedTrade } from "./types/tradingTypes";
import { FetchMod } from "./utils/DataFetcher/src";
import { string_symbol } from "./symbols";
import { bindStreamKeepAliveAsync } from "./utils/KeepAlive/src/async";
import { DbManager } from "./Components/DbManager";
import { DbConnector } from "./Components/DbManager/DbConnector";
import { LimitsManager } from "./Components/LimitsManager";
import {
  IOrderPayload,
  IWSOrderUpdateData,
  StreamCloseCallback,
  WsLiquidationOrder,
  ILeveragePayload,
  IMarginTypePayload,
  IGetOrderPayload,
  IFetchHistoricalTradesData,
  IGetAggTradesPayload,
  IFetchHistoricalCandlesData,
  IPingPayload,
  IGetCurrentServerTimePayload,
  IGetExchangeInfoPayload,
  IGetAllSymbolsPricesPayload,
  IGetPricePayload,
  IGetAvgPricePayload,
  IGetLastTradesPayload,
  IGetTradesHistoryPayload,
  IGetDailyStatsPayload,
  IGetAllBookTickersPayload,
  IGetCandlesPayload,
  ICancelOrderPayload,
  IWithdrawPayload,
  IGetAllOpenOrdersPayload,
  IGetAllOrdersPayload,
  IGetAccountInfoPayload,
  IGetAccountTradesPayload,
  IGetAccountTradesHistoryPayload,
  IGetTradesFeePayload,
  IGetTradeFeePayload,
  IGetDepositAddressPayload,
  IGetDepositHistoryPayload,
  IGetWithdrawHistoryPayload,
  IGetOrderBookPayload,
  IFetchHistoricalCandlesPayload,
  IGetAccountBalancePayload,
  IAccountBalance,
  IOrder,
  IStreamReturnObj,
  IWsOrderUpdateDataOptions,
  IGetPriceResponse,
  IWsMarginUpdateDataOptions,
  IWSChangeMarginTypeData,
  IWSBalanceUpdateData,
  IWsBalanceUpdateDataOptions
} from "./types/interface";
import { bindStreamKeepAlive } from "./utils/KeepAlive/src/sync";

export type string_sellorbuy = "BUY" | "SELL";
export type string_timeInForce = "FOK" | "GTC" | "IOC";
export type string_orderType =
  | "LIMIT"
  | "MARKET"
  | "STOP_LOSS"
  | "STOP_LOSS_LIMIT"
  | "TAKE_PROFIT"
  | "TAKE_PROFIT_LIMIT"
  | "LIMIT_MAKER"
  | 'STOP'
  | 'STOP_MARKET'
  | 'TAKE_PROFIT'
  | 'TAKE_PROFIT_MARKET'
  | 'TRAILING_STOP_MARKET';


export type string_interval =
  | "1m"
  | "3m"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "2h"
  | "4h"
  | "6h"
  | "7h"
  | "8h"
  | "12h"
  | "1d"
  | "3d"
  | "1w"
  | "1M";

export { string_symbol } from "./symbols";

export interface ExchangeCredential {
  apiKey: string;
  apiSecret: string;
  getTime?: () => number;
}

export type ExchangeName =
  "Binance" |
  "BinanceFutures" |
  "Bitmex";

const VALID_INTERVALS = [
  "1s",
  "5s",
  "15s",
  "30s",
  "45s",
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "6h",
  "7h",
  "8h",
  "12h",
  "1d",
  "3d",
  "1w",
  "1M"
];

export interface ExchangeAPIOptions {
  getTime?: () => number,
  useDbCaching?: boolean,
  apiCoreMethods_requestTimeout?: number
}


export abstract class ExchangeAPI {
  // members
  public abstract ws: WSExchangeAPI;
  protected abstract _name: string; // format =>  Xxxxxxx ex: Binance
  protected _dbManager?: DbManager; // TODO: see the type thing! port them to ExchangeAPI or not
  protected _useDbCaching?: boolean;
  protected _limitsManager?: LimitsManager;
  protected _ordersMethodsNames: string[] = [
    'order',
    // 'cancelOrder' // TODO: see all the other possible methods
  ];
  protected _apiCoreMethods_requestTimeout: number;
  protected _bindApiCoreMethodsExclusionList?: string[];

  constructor(
    apiKey: string | null = null,
    apiSecret: string | null = null,
    options?: ExchangeAPIOptions
  ) {
    options = options || {};

    this._useDbCaching = options.useDbCaching || true;

    this._apiCoreMethods_requestTimeout =
      options.apiCoreMethods_requestTimeout !== undefined ?
        options.apiCoreMethods_requestTimeout :
        30e3;

    this._init();
  }

  protected abstract _initLimitsManager(): void;
  protected abstract _getBindApiCoreMethodsExclusionList(): string[];

  protected _init() {
    this._initLimitsManager();
    this._bindMethods();
  }

  protected _bindMethods() {
    this._bindApiCoreMethods();
  }

  // TODO: rethink the whole thing
  private _bindApiCoreMethods() {
    /**
     *  TODO: note : Very important:
     *  The model doesn't work when a method use another method with the same ability!
     * So only the core methods of the api need to have the limitation management
     */
    const exclusionMethods = [
      'constructor',
      'setAuthCredentials',
      'ping',
      'setUseDbCaching',
      'passDbConnector',
      'isCandleIntervalValid',
      'getName',
      ...this._getBindApiCoreMethodsExclusionList()
    ];

    // TODO: better have the list of all methods to include
    const methodsNames = Object.getOwnPropertyNames(
      Object.getPrototypeOf(this)
    )
    .filter(
      (methodName) => (
        !exclusionMethods.includes(methodName) &&
        !methodName.match(/^_.*/) &&
        !methodName.match(/^gen_.*/) &&
        !methodName.match(/^fetchHistorical.*/)
      )
    );

    for (const methodName of methodsNames) {
      if (
          typeof (this as any)[methodName] === 'function'
      ) {
        const originalMethod = (this as any)[methodName].bind(this);

        const requestTimeoutBoundMethod = this._bindApiCoreMethodsRequestTimeout(
          methodName,
          originalMethod
        );

        const apiLimitsBoundMethod = this._bindLimitsCheckToMethod(
          methodName,
          requestTimeoutBoundMethod
        );

        (this as any)[methodName] = (...args: any[]) => {
          return apiLimitsBoundMethod(...args);
        }
      }
    }
  }

  private _bindApiCoreMethodsRequestTimeout(
    methodName: string,
    originalMethod: Function
  ) {
    return (...args: any[]) => {
      return new Promise((resolve, reject) => {
        let isResolved = false;
        originalMethod(...args)
        .then((resolutionValue: any) => {
          if (!isResolved) {
            isResolved = true;
            resolve(resolutionValue);
          }
        })
        .catch((err: any) => {
          if (!isResolved) {
            isResolved = true;
            reject(err);
          }
        });

        if (this._apiCoreMethods_requestTimeout) {
          /**
           * Note gonna happen if NaN or 0
           */
          setTimeout(() => {
            if (!isResolved) {
              isResolved = true;
              console.log('ERROR:');
              console.log('method name: ' + methodName);
              reject(new Error('Request Timeout'));
            }
          }, this._apiCoreMethods_requestTimeout);
        }
      });
    }
  }

  private _bindLimitsCheckToMethod(
    methodName: string,
    originalMethod: Function
  ) {
    if (this._limitsManager) {
      return this._limitsManager.resolveGetBindMethod(
        methodName,
        originalMethod
      );

      /**
       * no limits per methods
       */
    }

    return originalMethod;
  }

  // getters members

  // members setters
  public abstract setAuthCredentials(
    apiKey?: string,
    apiSecret?: string,
    getTime?: () => number
  ): ExchangeAPI;

  public getName() {
    return this._name;
  }

  /**
   *
   *
   * @param {string} interval
   * @returns {boolean}
   * @memberof ExchangeAPI
   */
  public isCandleIntervalValid(interval: string): boolean {
    // NOTE: can be overridden within each Exchange
    return VALID_INTERVALS.includes(interval);
  }

  // _______ db manager
  public passDbConnector(dbConnector: DbConnector) {
    this._dbManager = new DbManager(dbConnector);
    return this;
  }

  public setUseDbCaching(state: boolean) {
    this._useDbCaching = state;
    return this;
  }

  // api methods

  /**
   * All api methods return a promise
   */

  // ---- --------- no auth

  /**
   * test connection
   * output true false
   */
  public abstract ping(data?: IPingPayload): Promise<boolean>;

  /**
   * output server timestamp (int)
   */
  public abstract getCurrentServerTime(data?: IGetCurrentServerTimePayload): Promise<number>;

  /*
     output something like
                * {
            "timezone": "UTC",
            "serverTime": 1508631584636,
            "rateLimits": [
                {
                "rateLimitType": "REQUEST_WEIGHT",
                "interval": "MINUTE",
                "intervalNum": 1,
                "limit": 1200
                },
                {
                "rateLimitType": "ORDERS",
                "interval": "SECOND",
                "intervalNum": 1,
                "limit": 10
                },
                {
                "rateLimitType": "ORDERS",
                "interval": "DAY",
                "intervalNum": 1,
                "limit": 100000
                }
            ],
            "exchangeFilters": [],
            "symbols": [{
                "symbol": "ETHBTC",
                "status": "TRADING",
                "baseAsset": "ETH",
                "baseAssetPrecision": 8,
                "quoteAsset": "BTC",
                "quotePrecision": 8,
                "orderTypes": ["LIMIT", "MARKET"],
                "icebergAllowed": false,
                "filters": [{
                "filterType": "PRICE_FILTER",
                "minPrice": "0.00000100",
                "maxPrice": "100000.00000000",
                "tickSize": "0.00000100"
                }, {
                "filterType": "LOT_SIZE",
                "minQty": "0.00100000",
                "maxQty": "100000.00000000",
                "stepSize": "0.00100000"
                }, {
                "filterType": "MIN_NOTIONAL",
                "minNotional": "0.00100000"
                }]
            }]
            }
  */
  public abstract getExchangeInfo(data?: IGetExchangeInfoPayload): Promise<object>;

  /**
   * get all prices of all symbols in the exchange
   *
   * return :
   * [
   * {
   *      [symbol]: price,
   *      BTCUSD: 0.0054565
   * }
   * ]
   */
  public abstract getAllSymbolsPrices(data?: IGetAllSymbolsPricesPayload): Promise<{ [index: string]: string }>;

  /**
   * get the symbol price
   *
   * return number
   */
  public abstract getPrice(data: IGetPricePayload): Promise<IGetPriceResponse>;
  public abstract getAvgPrice(data: IGetAvgPricePayload): Promise<object>;

  /**
   * collection of last trades (1taker 1maker bid/ask  each trade have an id)
   */
  public abstract getLastTrades(data: IGetLastTradesPayload): Promise<object[]>;

  /* TODO: see where you can implement it (otherwise we can implement here in this interface using some other mean
  (then the original exchange api (if there is to investigate))) [to do]*/
  public abstract getTradesHistory(data: IGetTradesHistoryPayload): Promise<Trade[]>;

  /**
   *  Aggregated trades are trades of one ask to many bid
   * (don't know about inverse or sense  CONFIRM AND MODIFY THAT) [to do]
   * // params need explanation [to do]
   * @param {*} symbol :required
   * @param {*} fromId
   * @param {*} startTime
   * @param {*} endTime
   * @param {*} limit
   *
   */
  public abstract getAggregatedTrades(data: IGetAggTradesPayload): Promise<AggregatedTrade[]>;
  // !!!! lookout for the limitation (24 hour) (1taker/ many makers, that aggregated Trade) [to do]

  public abstract getDailyStats(data: IGetDailyStatsPayload): Promise<object>;

  public abstract getAllBookTickers(data?: IGetAllBookTickersPayload): Promise<{ [key: string]: object }>;
  // !!!!! [meaning obscure a little] !! [explain it well]  explain it doc[to do]

  public abstract getOrderBook(data: IGetOrderBookPayload): Promise<object>;

  /**
   *
   * @param {*} symbol  :required
   * @param {*} interval
   * @param {*} limit
   * @param {*} startTime
   * @param {*} endTime
   */
  public abstract getCandles(data: IGetCandlesPayload): Promise<Candle[]>;

  // -------- -------- auth required api

  /**
   * ordering
   *
   * explain all the different combinations type with the params (not all to be used) see the endpoint description!!!
   * also consider the different exchange later, consider using an array in place of all those arguments [to do]
   *
   * return (decide what it will be) [to do]
   * @param {*} symbol
   * @param {*} side  : SELL|BUY  (bid, ask)
   * @param {*} type
   * @param {*} quantity
   * @param {*} price
   * @param {*} stopPrice
   * @param {*} timeInForce
   * @param {*} icbergQuantity
   * @param {*} newClientOrderId
   * @param {*} newOrderRespType
   */
  public abstract order(payload: IOrderPayload): Promise<IOrder>;
  // sell () {}
  // /**
  //  * buy
  //  *  */
  // buy () {}
  // bid () {
  //     this.sell.apply(this, arguments)
  // } // aliases
  // ask () {
  //     this.buy.apply(this, arguments)
  // } //
  public abstract cancelOrder(data: ICancelOrderPayload): Promise<object>;

  public abstract withdraw(data: IWithdrawPayload): Promise<object>;

  public abstract getOrder(data: IGetOrderPayload): Promise<object>;
  public abstract getAllOpenOrders(data: IGetAllOpenOrdersPayload): Promise<object[]>; // only open orders
  public abstract getAllOrders(data: IGetAllOrdersPayload): Promise<object[]>;
  public abstract getAccountBalance(data?: IGetAccountBalancePayload): Promise<IAccountBalance[]>;
  public abstract getAccountInfo(data?: IGetAccountInfoPayload): Promise<object>; // current account (apikey ...)
  public abstract getAccountTrades(data: IGetAccountTradesPayload): Promise<object[]>; // the current account trades
  public abstract getAccountTradesHistory(data: IGetAccountTradesHistoryPayload): Promise<object[]>; // in binance diff in response (investigate that)
  public abstract getTradesFee(data?: IGetTradesFeePayload): Promise<{ tradeFee: object[]; success: boolean }>; // for all assets ;; return list
  public abstract getTradeFee(data: IGetTradeFeePayload): Promise<object>; // one asset :: return obj

  public abstract getDepositAddress(data: IGetDepositAddressPayload): Promise<object>;

  /**
   * no param is required
   *
   * @param {*} asset
   * @param {*} status
   * @param {*} startTime
   * @param {*} endTime
   * @memberof ExchangeAPI
   */
  public abstract getDepositHistory(data: IGetDepositHistoryPayload): Promise<{ depositList: object[]; success: boolean }>;
  public abstract getWithdrawHistory(data: IGetWithdrawHistoryPayload): Promise<{ withdrawList: object[]; success: boolean }>;


  public abstract setLeverage(payload: ILeveragePayload): Promise<object>;

  public abstract setMarginType(payload: IMarginTypePayload): Promise<object>;










  /**
   *
   * From here down
   * go all our separate methods
   *
   *
   */

  // _________________________________________________get historical data

  // _____________________________get candles historical data
  public abstract fetchHistoricalCandles(data: IFetchHistoricalCandlesPayload): Promise<Candle[]>;

  public abstract fetchHistoricalCandles_gen(params: IFetchHistoricalCandlesData): AsyncGenerator<Candle[]>;

  // _____________________________get trades historical data

  /**
   * fetch the data starting form the time, and doing it up to the trade endId. Or endTime.
   *
   * endId take precedence over endTime
   *
   * so for endTime to be used you need to not set endId (undefined)
   *
   * @abstract
   * @param {string_symbol} symbol
   * @param {number} startTime
   * @param {number} [endId]
   * @param {number} [endTime]
   * @param {number} [maxFetchChunkSize]
   * @returns {Promise<Trade[]>}
   * @memberof ExchangeAPI
   */
  public abstract fetchHistoricalTrades(data: IFetchHistoricalTradesData): Promise<Trade[]>;

  /**
   * the generator version of the above (for more memory efficiency)
   *
   * The return boolean type express with the run happened with no problems!
   * Or it failed (like trades.length = 0)
   *
   * @abstract
   * @param {string_symbol} symbol
   * @param {number} startTime
   * @param {number} [endId]
   * @param {number} [endTime]
   * @param {number} [maxFetchChunkSize]
   * @returns {AsyncGenerator<Trade[], boolean, Trade[]>}
   * @memberof ExchangeAPI
   */
  public abstract gen_fetchHistoricalTrades(
    data: IFetchHistoricalTradesData
  ): AsyncGenerator<Trade[], boolean, Trade[]>;

  public abstract fetchHistoricalTrades_lastPeriod(
    symbol: string_symbol,
    backPeriod: number
  ): Promise<Trade[]>;
  public abstract fetchHistoricalTrades_startingFrom(
    symbol: string_symbol,
    startTime: number
  ): Promise<Trade[]>;
  public abstract fetchHistoricalTrades_between(
    symbol: string_symbol,
    startTime: number,
    endTime: number
  ): Promise<Trade[]>;
}

export abstract class WSExchangeAPI {
  constructor(
    apiKey?: string,
    apiSecret?: string,
    getTime?: () => number,
    internal?: any
  ) {
    this._autoBindStreamKeepAlive(); // TODO: see && fix !!
  }

  /**
   * [NOTE] always remember to add functions that are not a stream to exclusion array
   *
   * @protected
   * @memberof WSExchangeAPI
   */
  protected _autoBindStreamKeepAlive() {
    const toExcludeMethods = [
      'constructor',
      'setAuthCredentials',
      'liquidationOrder',
      'user',
      'balanceUpdate',
      'marginTypeChangeUpdate',
      'ordersUpdate'
    ];

    for (const methodName of Object.getOwnPropertyNames(
        Object.getPrototypeOf(this)
    )) {
      if (
          typeof (this as any)[methodName] === 'function' &&
          !toExcludeMethods.includes(methodName)
      ) {
        const originalMethod = (this as any)[methodName].bind(this);

        (this as any)[methodName] = async (...args: any[]) => {
          let wsDriver: IWebSocketDriver;

          // _______ bind stream keep alive
          const { clearStream, getStreamObj, awaitReady } = await bindStreamKeepAlive(
            async ({
              beat,
              setter
            }) => {
                const callback = args[args.length - 1];
                const newArgs = [
                    ...args.slice(0, args.length - 1),
                    // ____ new callback
                    (...callbackArgs: any[]) => {
                        callback(...callbackArgs);
                        beat();
                    }
                ];

                const { closeStream, ws } = await originalMethod(...newArgs);

                setter.setClearStreamMethod(closeStream);
                setter.setStreamObj(ws);
                setter.setToReady();
            },
            {
                beatCheckTimeout: 30e3,
                afterReconnectBeatCheckTimeout: 30e3,
                onReconnectAttemptFinished: () => {
                  wsDriver.onInit();
                }
            }
          );

          // _____ await ready
          await awaitReady();

          // _____ get implemented WebSocketDriver
          wsDriver = this.getWebSocket(getStreamObj);

          return {
            closeStream: clearStream,
            ws: wsDriver
          };
        }
      }
    }
  }

  /**
   * Allow us to bind an implemented web socket driver
   *
   * @protected
   * @abstract
   * @param {WebSocket} ws
   * @returns {IWebSocketDriver}
   * @memberof WSExchangeAPI
   */
  protected abstract getWebSocket(getStreamObj: () => any): IWebSocketDriver;

  public abstract setAuthCredentials(
    apiKey?: string,
    apiSecret?: string,
    getTime?: () => number
  ): WSExchangeAPI;

  public abstract depth(
    symbols: string | string[],
    callback: (depth: object) => void
  ): Promise<IStreamReturnObj>; // TODO: change all to Promise<StreamReturnObj>

  /**
   *  *  symbol: string_symbol,
   *
   *
   * level: number,  : valide values (5, 10, 5)
   * callback
   *
   * @abstract
   * @param {string_symbol} symbol
   * @param {number} level
   * @param {(depth: object) => void} callback
   * @returns {(Promise<IStreamReturnObj>)}
   * @memberof WSExchangeAPI
   */
  public abstract partialDepth(
    symbol: string_symbol,
    level: number,
    callback: (depth: object) => void
  ): Promise<IStreamReturnObj>;

  public abstract ticker(
    symbols: string | string[],
    callback: (ticker: object) => void
  ): Promise<IStreamReturnObj>;

  public abstract allTickers(
    callback: (tickers: object[]) => void
  ): Promise<IStreamReturnObj>;

  public abstract candles(
    symbols: string | string[],
    interval: string,
    callback: (candle: Candle) => void
  ): Promise<IStreamReturnObj>;
  /**
   *
   *
   * @param {*} symbols : string or array
   * @param {*} callback
   * @memberof WSExchangeApi
   */
  public abstract trades(
    symbols: string | string[],
    callback: (trade: Trade) => void
  ): Promise<IStreamReturnObj>;
  /**
   *
   *
   * @param {*} symbols : string or array
   * @param {*} callback
   * @memberof WSExchangeApi
   */
  public abstract aggTrades(
    symbols: string | string[],
    callback: (trade: AggregatedTrade) => void
  ): Promise<IStreamReturnObj>;

  // auth based

  public abstract liquidationOrder(
    symbol: string_symbol,
    callback: (data: WsLiquidationOrder) => void
  ): Promise<IStreamReturnObj>

  // ______________________ user streams

  public abstract user(
    callback: (trade: object) => void
  ): Promise<IStreamReturnObj>;

  public abstract balanceUpdate(
    callback: (data: IWSBalanceUpdateData) => void,
    options?: IWsBalanceUpdateDataOptions
  ): Promise<IStreamReturnObj>;

  public abstract marginTypeChangeUpdate(
    callback: (data: IWSChangeMarginTypeData) => void,
    options?: IWsMarginUpdateDataOptions
  ): Promise<IStreamReturnObj>;

  /**
   * get the orders updates for the user
   * (it's on all symbols)
   * @abstract
   * @param {(data: IWSOrderUpdateData) => void} callback
   * @memberof WSExchangeAPI
   */
  public abstract ordersUpdate(
    callback: (data: IWSOrderUpdateData) => void,
    options?: IWsOrderUpdateDataOptions 
  ): Promise<IStreamReturnObj>;
}

// TODO: add error codes mapping [to do]


/**
 * A driver for a WebSocket like api implementation
 * 
 * The Point: Access to the change events! Which can be needed to manipulate streams interruptions and reconnection
 * 
 * note onInit => used to init internal variables
 * and setGetStreamObj => to set the function that allow us to get the stream object
 *
 * @export
 * @interface IWebSocketDriver
 */
export interface IWebSocketDriver {
  readonly protocol: string;
  readonly readyState: number;
  readonly url: string;
  binaryType: BinaryType;
  readonly CONNECTING: number;
  readonly OPEN: number;
  readonly CLOSING: number;
  readonly CLOSED: number;
  setGetStreamObj: (getStreamObj: () => WebSocket | IWebSocketDriver) => IWebSocketDriver;
  onInit: () => IWebSocketDriver;
  onopen: ((this: IWebSocketDriver, ev: Event) => any) | null;
  onmessage: ((this: IWebSocketDriver, ev: MessageEvent) => any) | null;
  onclose: ((this: IWebSocketDriver, ev: CloseEvent) => any) | null;
  onerror: ((this: IWebSocketDriver, ev: Event) => any) | null;
  close(code?: number, reason?: string): void;
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
}

/**
 * THINGS TO DO:
 * =============
 *
 *  decide and define the response output of all the functions
 *
 *  consider a design that add useful information that are exchange platform dependent
 *
 *
 *
 * STREAMS :
 * Need to precise what form the returned object should have
 *
 * ok dodo
 */
 const someVar = ''; // <=== added this
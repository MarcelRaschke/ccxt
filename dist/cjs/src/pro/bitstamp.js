'use strict';

var bitstamp$1 = require('../bitstamp.js');
var errors = require('../base/errors.js');
var Cache = require('../base/ws/Cache.js');
var Precise = require('../base/Precise.js');

// ----------------------------------------------------------------------------
//  ---------------------------------------------------------------------------
class bitstamp extends bitstamp$1 {
    describe() {
        return this.deepExtend(super.describe(), {
            'has': {
                'ws': true,
                'watchOrderBook': true,
                'watchOrders': true,
                'watchTrades': true,
                'watchTradesForSymbols': false,
                'watchOHLCV': false,
                'watchTicker': false,
                'watchTickers': false,
            },
            'urls': {
                'api': {
                    'ws': 'wss://ws.bitstamp.net',
                },
            },
            'options': {
                'expiresIn': '',
                'userId': '',
                'wsSessionToken': '',
                'watchOrderBook': {
                    'snapshotDelay': 6,
                    'snapshotMaxRetries': 3,
                },
                'tradesLimit': 1000,
                'OHLCVLimit': 1000,
            },
            'exceptions': {
                'exact': {
                    '4009': errors.AuthenticationError,
                },
            },
        });
    }
    /**
     * @method
     * @name bitstamp#watchOrderBook
     * @description watches information on open orders with bid (buy) and ask (sell) prices, volumes and other data
     * @param {string} symbol unified symbol of the market to fetch the order book for
     * @param {int} [limit] the maximum amount of order book entries to return
     * @param {object} [params] extra parameters specific to the exchange API endpoint
     * @returns {object} A dictionary of [order book structures]{@link https://docs.ccxt.com/#/?id=order-book-structure} indexed by market symbols
     */
    async watchOrderBook(symbol, limit = undefined, params = {}) {
        await this.loadMarkets();
        const market = this.market(symbol);
        symbol = market['symbol'];
        const messageHash = 'orderbook:' + symbol;
        const channel = 'diff_order_book_' + market['id'];
        const url = this.urls['api']['ws'];
        const request = {
            'event': 'bts:subscribe',
            'data': {
                'channel': channel,
            },
        };
        const message = this.extend(request, params);
        const orderbook = await this.watch(url, messageHash, message, messageHash);
        return orderbook.limit();
    }
    handleOrderBook(client, message) {
        //
        // initial snapshot is fetched with ccxt's fetchOrderBook
        // the feed does not include a snapshot, just the deltas
        //
        //     {
        //         "data": {
        //             "timestamp": "1583656800",
        //             "microtimestamp": "1583656800237527",
        //             "bids": [
        //                 ["8732.02", "0.00002478", "1207590500704256"],
        //                 ["8729.62", "0.01600000", "1207590502350849"],
        //                 ["8727.22", "0.01800000", "1207590504296448"],
        //             ],
        //             "asks": [
        //                 ["8735.67", "2.00000000", "1207590693249024"],
        //                 ["8735.67", "0.01700000", "1207590693634048"],
        //                 ["8735.68", "1.53294500", "1207590692048896"],
        //             ],
        //         },
        //         "event": "data",
        //         "channel": "diff_order_book_btcusd"
        //     }
        //
        const channel = this.safeString(message, 'channel');
        const parts = channel.split('_');
        const marketId = this.safeString(parts, 3);
        const symbol = this.safeSymbol(marketId);
        const storedOrderBook = this.safeValue(this.orderbooks, symbol);
        const nonce = this.safeValue(storedOrderBook, 'nonce');
        const delta = this.safeValue(message, 'data');
        const deltaNonce = this.safeInteger(delta, 'microtimestamp');
        const messageHash = 'orderbook:' + symbol;
        if (nonce === undefined) {
            const cacheLength = storedOrderBook.cache.length;
            // the rest API is very delayed
            // usually it takes at least 4-5 deltas to resolve
            const snapshotDelay = this.handleOption('watchOrderBook', 'snapshotDelay', 6);
            if (cacheLength === snapshotDelay) {
                this.spawn(this.loadOrderBook, client, messageHash, symbol, null, {});
            }
            storedOrderBook.cache.push(delta);
            return;
        }
        else if (nonce >= deltaNonce) {
            return;
        }
        this.handleDelta(storedOrderBook, delta);
        client.resolve(storedOrderBook, messageHash);
    }
    handleDelta(orderbook, delta) {
        const timestamp = this.safeTimestamp(delta, 'timestamp');
        orderbook['timestamp'] = timestamp;
        orderbook['datetime'] = this.iso8601(timestamp);
        orderbook['nonce'] = this.safeInteger(delta, 'microtimestamp');
        const bids = this.safeValue(delta, 'bids', []);
        const asks = this.safeValue(delta, 'asks', []);
        const storedBids = orderbook['bids'];
        const storedAsks = orderbook['asks'];
        this.handleBidAsks(storedBids, bids);
        this.handleBidAsks(storedAsks, asks);
    }
    handleBidAsks(bookSide, bidAsks) {
        for (let i = 0; i < bidAsks.length; i++) {
            const bidAsk = this.parseBidAsk(bidAsks[i]);
            bookSide.storeArray(bidAsk);
        }
    }
    getCacheIndex(orderbook, deltas) {
        // we will consider it a fail
        const firstElement = deltas[0];
        const firstElementNonce = this.safeInteger(firstElement, 'microtimestamp');
        const nonce = this.safeInteger(orderbook, 'nonce');
        if (nonce < firstElementNonce) {
            return -1;
        }
        for (let i = 0; i < deltas.length; i++) {
            const delta = deltas[i];
            const deltaNonce = this.safeInteger(delta, 'microtimestamp');
            if (deltaNonce === nonce) {
                return i + 1;
            }
        }
        return deltas.length;
    }
    /**
     * @method
     * @name bitstamp#watchTrades
     * @description get the list of most recent trades for a particular symbol
     * @param {string} symbol unified symbol of the market to fetch trades for
     * @param {int} [since] timestamp in ms of the earliest trade to fetch
     * @param {int} [limit] the maximum amount of trades to fetch
     * @param {object} [params] extra parameters specific to the exchange API endpoint
     * @returns {object[]} a list of [trade structures]{@link https://docs.ccxt.com/#/?id=public-trades}
     */
    async watchTrades(symbol, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets();
        const market = this.market(symbol);
        symbol = market['symbol'];
        const messageHash = 'trades:' + symbol;
        const url = this.urls['api']['ws'];
        const channel = 'live_trades_' + market['id'];
        const request = {
            'event': 'bts:subscribe',
            'data': {
                'channel': channel,
            },
        };
        const message = this.extend(request, params);
        const trades = await this.watch(url, messageHash, message, messageHash);
        if (this.newUpdates) {
            limit = trades.getLimit(symbol, limit);
        }
        return this.filterBySinceLimit(trades, since, limit, 'timestamp', true);
    }
    parseWsTrade(trade, market = undefined) {
        //
        //     {
        //         "buy_order_id": 1211625836466176,
        //         "amount_str": "1.08000000",
        //         "timestamp": "1584642064",
        //         "microtimestamp": "1584642064685000",
        //         "id": 108637852,
        //         "amount": 1.08,
        //         "sell_order_id": 1211625840754689,
        //         "price_str": "6294.77",
        //         "type": 1,
        //         "price": 6294.77
        //     }
        //
        const microtimestamp = this.safeInteger(trade, 'microtimestamp');
        const id = this.safeString(trade, 'id');
        const timestamp = this.parseToInt(microtimestamp / 1000);
        const price = this.safeString(trade, 'price');
        const amount = this.safeString(trade, 'amount');
        const symbol = market['symbol'];
        const sideRaw = this.safeInteger(trade, 'type');
        const side = (sideRaw === 0) ? 'buy' : 'sell';
        return this.safeTrade({
            'info': trade,
            'timestamp': timestamp,
            'datetime': this.iso8601(timestamp),
            'symbol': symbol,
            'id': id,
            'order': undefined,
            'type': undefined,
            'takerOrMaker': undefined,
            'side': side,
            'price': price,
            'amount': amount,
            'cost': undefined,
            'fee': undefined,
        }, market);
    }
    handleTrade(client, message) {
        //
        //     {
        //         "data": {
        //             "buy_order_id": 1207733769326592,
        //             "amount_str": "0.14406384",
        //             "timestamp": "1583691851",
        //             "microtimestamp": "1583691851934000",
        //             "id": 106833903,
        //             "amount": 0.14406384,
        //             "sell_order_id": 1207733765476352,
        //             "price_str": "8302.92",
        //             "type": 0,
        //             "price": 8302.92
        //         },
        //         "event": "trade",
        //         "channel": "live_trades_btcusd"
        //     }
        //
        // the trade streams push raw trade information in real-time
        // each trade has a unique buyer and seller
        const channel = this.safeString(message, 'channel');
        const parts = channel.split('_');
        const marketId = this.safeString(parts, 2);
        const market = this.safeMarket(marketId);
        const symbol = market['symbol'];
        const messageHash = 'trades:' + symbol;
        const data = this.safeValue(message, 'data');
        const trade = this.parseWsTrade(data, market);
        let tradesArray = this.safeValue(this.trades, symbol);
        if (tradesArray === undefined) {
            const limit = this.safeInteger(this.options, 'tradesLimit', 1000);
            tradesArray = new Cache.ArrayCache(limit);
            this.trades[symbol] = tradesArray;
        }
        tradesArray.append(trade);
        client.resolve(tradesArray, messageHash);
    }
    /**
     * @method
     * @name bitstamp#watchOrders
     * @description watches information on multiple orders made by the user
     * @param {string} symbol unified market symbol of the market orders were made in
     * @param {int} [since] the earliest time in ms to fetch orders for
     * @param {int} [limit] the maximum number of order structures to retrieve
     * @param {object} [params] extra parameters specific to the exchange API endpoint
     * @returns {object[]} a list of [order structures]{@link https://docs.ccxt.com/#/?id=order-structure}
     */
    async watchOrders(symbol = undefined, since = undefined, limit = undefined, params = {}) {
        if (symbol === undefined) {
            throw new errors.ArgumentsRequired(this.id + ' watchOrders() requires a symbol argument');
        }
        await this.loadMarkets();
        const market = this.market(symbol);
        symbol = market['symbol'];
        const channel = 'private-my_orders';
        const messageHash = channel + '_' + market['id'];
        const subscription = {
            'symbol': symbol,
            'limit': limit,
            'type': channel,
            'params': params,
        };
        const orders = await this.subscribePrivate(subscription, messageHash, params);
        if (this.newUpdates) {
            limit = orders.getLimit(symbol, limit);
        }
        return this.filterBySinceLimit(orders, since, limit, 'timestamp', true);
    }
    handleOrders(client, message) {
        //
        // {
        //     "data":{
        //        "id":"1463471322288128",
        //        "id_str":"1463471322288128",
        //        "order_type":1,
        //        "datetime":"1646127778",
        //        "microtimestamp":"1646127777950000",
        //        "amount":0.05,
        //        "amount_str":"0.05000000",
        //        "price":1000,
        //        "price_str":"1000.00"
        //     },
        //     "channel":"private-my_orders_ltcusd-4848701",
        //     "event": "order_deleted" // field only present for cancelOrder
        // }
        //
        const channel = this.safeString(message, 'channel');
        const order = this.safeValue(message, 'data', {});
        const limit = this.safeInteger(this.options, 'ordersLimit', 1000);
        if (this.orders === undefined) {
            this.orders = new Cache.ArrayCacheBySymbolById(limit);
        }
        const stored = this.orders;
        const subscription = this.safeValue(client.subscriptions, channel);
        const symbol = this.safeString(subscription, 'symbol');
        const market = this.market(symbol);
        order['event'] = this.safeString(message, 'event');
        const parsed = this.parseWsOrder(order, market);
        stored.append(parsed);
        client.resolve(this.orders, channel);
    }
    parseWsOrder(order, market = undefined) {
        //
        //    {
        //        "id": "1894876776091648",
        //        "id_str": "1894876776091648",
        //        "order_type": 0,
        //        "order_subtype": 0,
        //        "datetime": "1751451375",
        //        "microtimestamp": "1751451375070000",
        //        "amount": 1.1,
        //        "amount_str": "1.10000000",
        //        "amount_traded": "0",
        //        "amount_at_create": "1.10000000",
        //        "price": 10.23,
        //        "price_str": "10.23",
        //        "is_liquidation": false,
        //        "trade_account_id": 0
        //    }
        //
        const id = this.safeString(order, 'id_str');
        const orderTypeRaw = this.safeStringLower(order, 'order_type');
        const side = (orderTypeRaw === '1') ? 'sell' : 'buy';
        const orderSubTypeRaw = this.safeStringLower(order, 'order_subtype'); // https://www.bitstamp.net/websocket/v2/#:~:text=order_subtype
        let orderType = undefined;
        let timeInForce = undefined;
        if (orderSubTypeRaw === '0') {
            orderType = 'limit';
        }
        else if (orderSubTypeRaw === '2') {
            orderType = 'market';
        }
        else if (orderSubTypeRaw === '4') {
            orderType = 'limit';
            timeInForce = 'IOC';
        }
        else if (orderSubTypeRaw === '6') {
            orderType = 'limit';
            timeInForce = 'FOK';
        }
        else if (orderSubTypeRaw === '8') {
            orderType = 'limit';
            timeInForce = 'GTD';
        }
        const price = this.safeString(order, 'price_str');
        const amount = this.safeString(order, 'amount_str');
        const filled = this.safeString(order, 'amount_traded');
        const event = this.safeString(order, 'event');
        let status = undefined;
        if (Precise["default"].stringEq(filled, amount)) {
            status = 'closed';
        }
        else if (event === 'order_deleted') {
            status = 'canceled';
        }
        const timestamp = this.safeTimestamp(order, 'datetime');
        market = this.safeMarket(undefined, market);
        const symbol = market['symbol'];
        return this.safeOrder({
            'info': order,
            'symbol': symbol,
            'id': id,
            'clientOrderId': undefined,
            'timestamp': timestamp,
            'datetime': this.iso8601(timestamp),
            'lastTradeTimestamp': undefined,
            'type': orderType,
            'timeInForce': timeInForce,
            'postOnly': undefined,
            'side': side,
            'price': price,
            'stopPrice': undefined,
            'triggerPrice': undefined,
            'amount': amount,
            'cost': undefined,
            'average': undefined,
            'filled': filled,
            'remaining': undefined,
            'status': status,
            'fee': undefined,
            'trades': undefined,
        }, market);
    }
    handleOrderBookSubscription(client, message) {
        const channel = this.safeString(message, 'channel');
        const parts = channel.split('_');
        const marketId = this.safeString(parts, 3);
        const symbol = this.safeSymbol(marketId);
        this.orderbooks[symbol] = this.orderBook();
    }
    handleSubscriptionStatus(client, message) {
        //
        //     {
        //         "event": "bts:subscription_succeeded",
        //         "channel": "detail_order_book_btcusd",
        //         "data": {},
        //     }
        //     {
        //         "event": "bts:subscription_succeeded",
        //         "channel": "private-my_orders_ltcusd-4848701",
        //         "data": {}
        //     }
        //
        const channel = this.safeString(message, 'channel');
        if (channel.indexOf('order_book') > -1) {
            this.handleOrderBookSubscription(client, message);
        }
    }
    handleSubject(client, message) {
        //
        //     {
        //         "data": {
        //             "timestamp": "1583656800",
        //             "microtimestamp": "1583656800237527",
        //             "bids": [
        //                 ["8732.02", "0.00002478", "1207590500704256"],
        //                 ["8729.62", "0.01600000", "1207590502350849"],
        //                 ["8727.22", "0.01800000", "1207590504296448"],
        //             ],
        //             "asks": [
        //                 ["8735.67", "2.00000000", "1207590693249024"],
        //                 ["8735.67", "0.01700000", "1207590693634048"],
        //                 ["8735.68", "1.53294500", "1207590692048896"],
        //             ],
        //         },
        //         "event": "data",
        //         "channel": "detail_order_book_btcusd"
        //     }
        //
        // private order
        //     {
        //         "data":{
        //         "id":"1463471322288128",
        //         "id_str":"1463471322288128",
        //         "order_type":1,
        //         "datetime":"1646127778",
        //         "microtimestamp":"1646127777950000",
        //         "amount":0.05,
        //         "amount_str":"0.05000000",
        //         "price":1000,
        //         "price_str":"1000.00"
        //         },
        //         "channel":"private-my_orders_ltcusd-4848701",
        //         "event": "order_deleted" // field only present for cancelOrder
        //     }
        //
        const channel = this.safeString(message, 'channel');
        const methods = {
            'live_trades': this.handleTrade,
            'diff_order_book': this.handleOrderBook,
            'private-my_orders': this.handleOrders,
        };
        const keys = Object.keys(methods);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (channel.indexOf(key) > -1) {
                const method = methods[key];
                method.call(this, client, message);
            }
        }
    }
    handleErrorMessage(client, message) {
        // {
        //     "event": "bts:error",
        //     "channel": '',
        //     "data": { code: 4009, message: "Connection is unauthorized." }
        // }
        const event = this.safeString(message, 'event');
        if (event === 'bts:error') {
            const feedback = this.id + ' ' + this.json(message);
            const data = this.safeValue(message, 'data', {});
            const code = this.safeNumber(data, 'code');
            this.throwExactlyMatchedException(this.exceptions['exact'], code, feedback);
        }
        return message;
    }
    handleMessage(client, message) {
        if (!this.handleErrorMessage(client, message)) {
            return;
        }
        //
        //     {
        //         "event": "bts:subscription_succeeded",
        //         "channel": "detail_order_book_btcusd",
        //         "data": {},
        //     }
        //
        //     {
        //         "data": {
        //             "timestamp": "1583656800",
        //             "microtimestamp": "1583656800237527",
        //             "bids": [
        //                 ["8732.02", "0.00002478", "1207590500704256"],
        //                 ["8729.62", "0.01600000", "1207590502350849"],
        //                 ["8727.22", "0.01800000", "1207590504296448"],
        //             ],
        //             "asks": [
        //                 ["8735.67", "2.00000000", "1207590693249024"],
        //                 ["8735.67", "0.01700000", "1207590693634048"],
        //                 ["8735.68", "1.53294500", "1207590692048896"],
        //             ],
        //         },
        //         "event": "data",
        //         "channel": "detail_order_book_btcusd"
        //     }
        //
        //     {
        //         "event": "bts:subscription_succeeded",
        //         "channel": "private-my_orders_ltcusd-4848701",
        //         "data": {}
        //     }
        //
        const event = this.safeString(message, 'event');
        if (event === 'bts:subscription_succeeded') {
            this.handleSubscriptionStatus(client, message);
        }
        else {
            this.handleSubject(client, message);
        }
    }
    async authenticate(params = {}) {
        this.checkRequiredCredentials();
        const time = this.milliseconds();
        const expiresIn = this.safeInteger(this.options, 'expiresIn');
        if ((expiresIn === undefined) || (time > expiresIn)) {
            const response = await this.privatePostWebsocketsToken(params);
            //
            // {
            //     "valid_sec":60,
            //     "token":"siPaT4m6VGQCdsDCVbLBemiphHQs552e",
            //     "user_id":4848701
            // }
            //
            const sessionToken = this.safeString(response, 'token');
            if (sessionToken !== undefined) {
                const userId = this.safeString(response, 'user_id');
                const validity = this.safeIntegerProduct(response, 'valid_sec', 1000);
                this.options['expiresIn'] = this.sum(time, validity);
                this.options['userId'] = userId;
                this.options['wsSessionToken'] = sessionToken;
            }
        }
    }
    async subscribePrivate(subscription, messageHash, params = {}) {
        const url = this.urls['api']['ws'];
        await this.authenticate();
        messageHash += '-' + this.options['userId'];
        const request = {
            'event': 'bts:subscribe',
            'data': {
                'channel': messageHash,
                'auth': this.options['wsSessionToken'],
            },
        };
        subscription['messageHash'] = messageHash;
        return await this.watch(url, messageHash, this.extend(request, params), messageHash, subscription);
    }
}

module.exports = bitstamp;

import * as giftbitRoutes from "giftbit-cassava-routes";
import {pick} from "../utils/pick";

export interface Currency {
    code: string;
    name: string;
    symbol: string;
    decimalPlaces: number;
}

export namespace Currency {
    export function toDbCurrency(auth: giftbitRoutes.jwtauth.AuthorizationBadge, c: Currency): DbCurrency {
        return {
            userId: auth.userId,
            code: c.code,
            name: c.name,
            symbol: c.symbol,
            decimalPlaces: c.decimalPlaces
        };
    }

    export function toDbCurrencyUpdate(c: Partial<Currency>): Partial<DbCurrency> {
        return pick(c, "name", "symbol", "decimalPlaces");
    }
}

export interface DbCurrency {
    userId: string;
    code: string;
    name: string;
    symbol: string;
    decimalPlaces: number;
}

export namespace DbCurrency {
    export function toCurrency(c: Currency): Currency {
        return {
            code: c.code,
            name: c.name,
            symbol: c.symbol,
            decimalPlaces: c.decimalPlaces
        };
    }
}

export function formatAmountForCurrencyDisplay(amountInSmallestUnits: number, c: Currency) {
    let converted = amountInSmallestUnits / (Math.pow(10, c.decimalPlaces));
    return c.symbol + converted.toFixed(c.decimalPlaces);
}
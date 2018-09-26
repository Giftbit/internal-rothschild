import * as giftbitRoutes from "giftbit-cassava-routes";
import {pick} from "../utils/pick";
import {getCurrency} from "../lambdas/rest/currencies";

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

export async function formatForCurrencyDisplay(auth: giftbitRoutes.jwtauth.AuthorizationBadge, objects: any[], type: string): Promise<any[]> {
    let formattedValues = [];
    let retrievedCurrencies: { [key: string]: Currency } = {};
    for (let object of objects) {
        if (!retrievedCurrencies[object.currency]) {
            retrievedCurrencies[object.currency] = await getCurrency(auth, object.currency);
        }
        if (type == "Value") {
            formattedValues.push({
                ...object,
                balance: formatCentsForCurrencyDisplay(object.balance, retrievedCurrencies[object.currency])
            });
        }
    }
    return formattedValues;
}

export function formatCentsForCurrencyDisplay(cents: number, c: Currency) {
    let converted = cents / (Math.pow(10, c.decimalPlaces));
    return c.symbol + converted.toFixed(c.decimalPlaces);
}
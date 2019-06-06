import * as giftbitRoutes from "giftbit-cassava-routes";
import {pick} from "../utils/pick";
import {mapUtils} from "../utils/mapUtils";
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

export function formatAmountForCurrencyDisplay(amountInSmallestUnits: number, c: Currency) {
    const converted = amountInSmallestUnits / (Math.pow(10, c.decimalPlaces));
    return c.symbol + converted.toFixed(c.decimalPlaces);
}

/**
 * params:
 * - objects:
 *   - must be an object that has a 'currency' property.
 * - pathsToAmountProperties
 *   - paths to object properties that contain an amount that should be formatted for currency display.
 *   - nested properties can be accessed by adding a '.' within the property path string. ie "nestedProp.amountInCents"
 */
export async function formatObjectsAmountPropertiesForCurrencyDisplay(auth: giftbitRoutes.jwtauth.AuthorizationBadge, objects: any[], pathsToAmountProperties: string[]): Promise<any[]> {
    const retrievedCurrencies: { [key: string]: Currency } = {};
    const results: any[] = [];
    for (const object of objects) {
        const currency: string = mapUtils.get(object, "currency");
        if (!currency) {
            throw new Error("Invalid usage. All objects passed in must have a currency defined by the currencyPath")
        }
        if (!retrievedCurrencies[currency]) {
            retrievedCurrencies[currency] = await getCurrency(auth, currency);
        }

        let objectClone = JSON.parse(JSON.stringify(object));
        for (const path of pathsToAmountProperties) {
            let valueAtPath = mapUtils.get(object, path);
            if (valueAtPath != null) {
                objectClone = mapUtils.set(objectClone, path, formatAmountForCurrencyDisplay(valueAtPath, retrievedCurrencies[currency]));
            }
        }
        results.push(objectClone);
    }
    return results;
}
import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as jsonschema from "jsonschema";
import {Currency, DbCurrency, formatAmountForCurrencyDisplay} from "../../model/Currency";
import {pick} from "../../utils/pick";
import {csvSerializer} from "../../serializers";
import {getKnexRead, getKnexWrite} from "../../utils/dbUtils/connection";
import {MapUtils} from "../../utils/mapUtils";

export function installCurrenciesRest(router: cassava.Router): void {
    router.route("/v2/currencies")
        .method("GET")
        .serializers({
            "application/json": cassava.serializers.jsonSerializer,
            "text/csv": csvSerializer
        })
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            auth.requireScopes("lightrailV2:currencies:list");
            return {
                body: await getCurrencies(auth)
            };
        });

    router.route("/v2/currencies")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            auth.requireScopes("lightrailV2:currencies:create");
            evt.validateBody(currencySchema);

            const currency = pick(evt.body, "code", "name", "symbol", "decimalPlaces") as Currency;
            return {
                statusCode: cassava.httpStatusCode.success.CREATED,
                body: await createCurrency(auth, currency)
            };
        });

    router.route("/v2/currencies/{code}")
        .method("GET")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            auth.requireScopes("lightrailV2:currencies:read");
            return {
                body: await getCurrency(auth, evt.pathParameters.code)
            };
        });

    router.route("/v2/currencies/{code}")
        .method("PATCH")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            auth.requireScopes("lightrailV2:currencies:update");
            evt.validateBody(currencyUpdateSchema);

            if (evt.body.code !== undefined && evt.body.code !== evt.pathParameters.code) {
                throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `The path code '${evt.pathParameters.code}' does not match the body code '${evt.body.code}'.`);
            }

            const currency = pick<Currency>(evt.body, "name", "symbol", "decimalPlaces");
            return {
                body: await updateCurrency(auth, evt.pathParameters.code, currency)
            };
        });

    router.route("/v2/currencies/{code}")
        .method("DELETE")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            auth.requireScopes("lightrailV2:currencies:delete");
            return {
                body: await deleteCurrency(auth, evt.pathParameters.code)
            };
        });
}

export async function getCurrencies(auth: giftbitRoutes.jwtauth.AuthorizationBadge): Promise<Currency[]> {
    auth.requireIds("userId");

    const knex = await getKnexRead();
    const res: DbCurrency[] = await knex("Currencies")
        .select()
        .where({
            userId: auth.userId
        })
        .orderBy("code");
    return res.map(DbCurrency.toCurrency);
}

export async function createCurrency(auth: giftbitRoutes.jwtauth.AuthorizationBadge, currency: Currency): Promise<Currency> {
    auth.requireIds("userId");

    try {
        const knex = await getKnexWrite();
        await knex("Currencies")
            .insert(Currency.toDbCurrency(auth, currency));
        return currency;
    } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Currency with code '${currency.code}' already exists.`, "CurrencyExists");
        }
        throw err;
    }
}

export async function getCurrency(auth: giftbitRoutes.jwtauth.AuthorizationBadge, code: string): Promise<Currency> {
    auth.requireIds("userId");

    const knex = await getKnexRead();
    const res: DbCurrency[] = await knex("Currencies")
        .select()
        .where({
            userId: auth.userId,
            code: code
        });
    if (res.length === 0) {
        throw new cassava.RestError(404);
    }
    if (res.length > 1) {
        throw new Error(`Illegal SELECT query.  Returned ${res.length} values.`);
    }
    return DbCurrency.toCurrency(res[0]);
}

export async function updateCurrency(auth: giftbitRoutes.jwtauth.AuthorizationBadge, code: string, currencyUpdates: Partial<Currency>): Promise<Currency> {
    auth.requireIds("userId");

    const knex = await getKnexWrite();
    return knex.transaction(async trx => {
        // Get the master version of the Currency and lock it.
        const currencyRes: DbCurrency[] = await trx("Currencies")
            .select()
            .where({
                userId: auth.userId,
                code: code
            })
            .forUpdate();
        if (currencyRes.length === 0) {
            throw new cassava.RestError(404);
        }
        if (currencyRes.length > 1) {
            throw new Error(`Illegal SELECT query.  Returned ${currencyRes.length} values.`);
        }
        const existingCurrency = DbCurrency.toCurrency(currencyRes[0]);
        const updatedCurrency = {
            ...existingCurrency,
            ...currencyUpdates
        };

        const patchRes: number = await trx("Currencies")
            .where({
                userId: auth.userId,
                code: code
            })
            .update(Currency.toDbCurrencyUpdate(currencyUpdates));
        if (patchRes === 0) {
            throw new cassava.RestError(404);
        }
        if (patchRes > 1) {
            throw new Error(`Illegal UPDATE query.  Updated ${patchRes} values.`);
        }
        return updatedCurrency;
    });
}

export async function deleteCurrency(auth: giftbitRoutes.jwtauth.AuthorizationBadge, code: string): Promise<{ success: true }> {
    auth.requireIds("userId");

    try {
        const knex = await getKnexWrite();
        const res: number = await knex("Currencies")
            .where({
                userId: auth.userId,
                code: code
            })
            .delete();
        if (res === 0) {
            throw new cassava.RestError(404);
        }
        if (res > 1) {
            throw new Error(`Illegal DELETE query.  Deleted ${res} values.`);
        }
        return {success: true};
    } catch (err) {
        if (err.code === "ER_ROW_IS_REFERENCED_2") {
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Currency '${code}' is in use.`, "CurrencyInUse");
        }
        throw err;
    }
}

export async function formatCurrencyForDisplay(auth: giftbitRoutes.jwtauth.AuthorizationBadge, objects: any[], objectPaths: string[], currencyPath: string = "currency"): Promise<any[]> {
    const retrievedCurrencies: { [key: string]: Currency } = {};
    const results: any[] = [];
    for (const object of objects) {
        const currency: string = MapUtils.get(object, currencyPath);
        if (!currency) {
            throw new Error("Invalid usage. All objects passed in must have a currency defined by the currencyPath")
        }
        if (!retrievedCurrencies[currency]) {
            retrievedCurrencies[currency] = await getCurrency(auth, currency);
        }

        const objectClone = {...object};
        for (const path of objectPaths) {
            let valueAtPath = MapUtils.get(object, path);
            if (valueAtPath != null) {
                MapUtils.set(objectClone, path, formatAmountForCurrencyDisplay(valueAtPath, retrievedCurrencies[currency]));
            }
        }
        results.push(objectClone);
    }
    return results;
}

const currencySchema: jsonschema.Schema = {
    type: "object",
    properties: {
        code: {
            type: "string",
            maxLength: 16,
            minLength: 1,
            pattern: "^[ -~]*$"
        },
        name: {
            type: "string",
            maxLength: 255,
            minLength: 1
        },
        symbol: {
            type: "string",
            maxLength: 16,
            minLength: 1
        },
        decimalPlaces: {
            type: "integer",
            minimum: 0,
            maximum: 4
        }
    },
    required: ["code", "name", "symbol", "decimalPlaces"]
};

const currencyUpdateSchema: jsonschema.Schema = {
    ...currencySchema,
    required: []
};

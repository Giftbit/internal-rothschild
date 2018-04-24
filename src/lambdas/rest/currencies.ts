import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as jsonschema from "jsonschema";
import {getKnexWrite, getKnexRead} from "../../dbUtils";
import {Currency} from "../../model/Currency";
import {pick} from "../../pick";

export function installCustomersRest(router: cassava.Router): void {
    router.route("/v2/currencies")
        .method("GET")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            return {
                body: await getCurrencies(auth)
            };
        });

    router.route("/v2/currencies")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
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
            auth.requireIds("giftbitUserId");
            return {
                body: await getCurrency(auth, evt.pathParameters.customerId)
            };
        });

    router.route("/v2/currencies/{code}")
        .method("PATCH")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
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
            auth.requireIds("giftbitUserId");
            return {
                body: await deleteCurrency(auth, evt.pathParameters.code)
            };
        });
}

export async function getCurrencies(auth: giftbitRoutes.jwtauth.AuthorizationBadge): Promise<Currency[]> {
    auth.requireIds("giftbitUserId");

    const knex = await getKnexRead();
    const res: Currency[] = await knex("Currencies")
        .select()
        .where({
            userId: auth.giftbitUserId
        })
        .orderBy("code");
    return res;
}

export async function createCurrency(auth: giftbitRoutes.jwtauth.AuthorizationBadge, currency: Currency): Promise<Currency> {
    auth.requireIds("giftbitUserId");

    try {
        const knex = await getKnexWrite();
        await knex("Currencies")
            .insert(currency);
        return currency;
    } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `Currency with code '${currency.code}' already exists.`);
        }
        throw err;
    }
}

export async function getCurrency(auth: giftbitRoutes.jwtauth.AuthorizationBadge, code: string): Promise<Currency> {
    auth.requireIds("giftbitUserId");

    const knex = await getKnexRead();
    const res: Currency[] = await knex("Customers")
        .select()
        .where({
            userId: auth.giftbitUserId,
            code: code
        });
    if (res.length === 0) {
        throw new cassava.RestError(404);
    }
    if (res.length > 1) {
        throw new Error(`Illegal SELECT query.  Returned ${res.length} values.`);
    }
    return res[0];
}

export async function updateCurrency(auth: giftbitRoutes.jwtauth.AuthorizationBadge, code: string, currency: Partial<Currency>): Promise<Currency> {
    auth.requireIds("giftbitUserId");

    const knex = await getKnexWrite();
    const res: [number] = await knex("Currencies")
        .where({
            userId: auth.giftbitUserId,
            code: code
        })
        .update(currency);
    if (res[0] === 0) {
        throw new cassava.RestError(404);
    }
    if (res[0] > 1) {
        throw new Error(`Illegal UPDATE query.  Updated ${res.length} values.`);
    }
    return {
        ...getCurrency(auth, code),
        ...currency
    };
}

export async function deleteCurrency(auth: giftbitRoutes.jwtauth.AuthorizationBadge, code: string): Promise<{success: true}> {
    auth.requireIds("giftbitUserId");

    const knex = await getKnexWrite();
    const res: [number] = await knex("Currencies")
        .where({
            userId: auth.giftbitUserId,
            code: code
        })
        .delete();
    if (res[0] === 0) {
        throw new cassava.RestError(404);
    }
    if (res[0] > 1) {
        throw new Error(`Illegal DELETE query.  Deleted ${res.length} values.`);
    }
    return {success: true};
}

const currencySchema: jsonschema.Schema = {
    type: "object",
    properties: {
        code: {
            type: "string",
            maxLength: 16,
            minLength: 1
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

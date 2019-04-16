import * as giftbitRoutes from "giftbit-cassava-routes";
import {GiftbitRestError} from "giftbit-cassava-routes";
import * as Knex from "knex";
import {DbValue, Value} from "../../model/Value";
import {dateInDbPrecision, getSqlErrorConstraintName, nowInDbPrecision} from "../../utils/dbUtils";
import {DbTransaction, LightrailDbTransactionStep} from "../../model/Transaction";
import * as cassava from "cassava";
import {MetricsLogger, ValueAttachmentTypes} from "../../utils/metricsLogger";
import {Program} from "../../model/Program";
import {GenerateCodeParameters} from "../../model/GenerateCodeParameters";
import {pickOrDefault} from "../../utils/pick";
import {generateCode} from "../../utils/codeGenerator";
import {CreateValueParameters} from "./values";
import {checkRulesSyntax} from "./transactions/rules/RuleContext";
import {insertValue} from "./transactions/insertTransactions";
import log = require("loglevel");

export namespace ValueCreationService {

    export async function createValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, params: CreateValueParameters, trx: Knex.Transaction, retryCount: number = 0): Promise<Value> {
        auth.requireIds("userId", "teamMemberId");
        let value: Value = initializeValue(auth, params.partialValue, params.program, params.generateCodeParameters);
        log.info(`Create Value requested for user: ${auth.userId}. Value`, Value.toStringSanitized(value));

        value.startDate = value.startDate ? dateInDbPrecision(new Date(value.startDate)) : null;
        value.endDate = value.endDate ? dateInDbPrecision(new Date(value.endDate)) : null;

        // todo - this awkwardly doesn't work as a TransactionPlan even though steps can support creating Values. This is complicated by issuances where the knex trx involves creating all Values.
        let dbValue: DbValue;
        try {
            dbValue = await insertValue(auth, trx, value);
        } catch (err) {
            /**
             *  Retrying twice is an arbitrary number. This may need to be increased if we're still seeing regular failures.
             *  Unless users are using their own character set there are around 1 billion possible codes.
             *  It seems unlikely for 3+ retry failures even if users have millions of codes. */
            if (err instanceof GiftbitRestError && err.additionalParams["messageCode"] === "ValueCodeExists" && params.generateCodeParameters && retryCount < 2) {
                log.info(`Retrying creating the Value because there was a code uniqueness constraint failure for a generated code. Retry number: ${retryCount}. ValueId: ${params.partialValue.id}.`);
                return createValue(auth, params, trx, retryCount + 1);
            }
            throw err
        }
        if (value.balance || value.usesRemaining) {
            try {
                const transactionId = value.id;
                const initialBalanceTransaction: DbTransaction = {
                    userId: auth.userId,
                    id: transactionId,
                    transactionType: "initialBalance",
                    currency: value.currency,
                    totals_subtotal: null,
                    totals_tax: null,
                    totals_discountLightrail: null,
                    totals_paidLightrail: null,
                    totals_paidStripe: null,
                    totals_paidInternal: null,
                    totals_remainder: null,
                    totals_marketplace_sellerGross: null,
                    totals_marketplace_sellerDiscount: null,
                    totals_marketplace_sellerNet: null,
                    lineItems: null,
                    paymentSources: null,
                    pendingVoidDate: null,
                    metadata: null,
                    rootTransactionId: transactionId,
                    nextTransactionId: null,
                    createdDate: value.createdDate,
                    tax: null,
                    createdBy: auth.teamMemberId,
                };
                const initialBalanceTransactionStep: LightrailDbTransactionStep = {
                    userId: auth.userId,
                    id: `${value.id}-0`,
                    transactionId: transactionId,
                    valueId: value.id,
                    balanceBefore: value.balance != null ? 0 : null,
                    balanceAfter: value.balance,
                    balanceChange: value.balance,
                    usesRemainingBefore: value.usesRemaining != null ? 0 : null,
                    usesRemainingAfter: value.usesRemaining,
                    usesRemainingChange: value.usesRemaining
                };
                await trx.into("Transactions").insert(initialBalanceTransaction);
                await trx.into("LightrailTransactionSteps").insert(initialBalanceTransactionStep);
            } catch
                (err) {
                log.debug(err);
                const constraint = getSqlErrorConstraintName(err);
                if (constraint === "PRIMARY") {
                    throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `A Transaction with id '${value.id}' already exists.`, "TransactionExists");
                }
                throw err;
            }
        }

        if (value.contactId) {
            MetricsLogger.valueAttachment(ValueAttachmentTypes.OnCreate, auth);
        }

        return DbValue.toValue(dbValue, params.showCode);
    }

    export function initializeValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, partialValue: Partial<Value>, program: Program = null, generateCodeParameters: GenerateCodeParameters = null): Value {
        const now = nowInDbPrecision();

        let value: Value = pickOrDefault(partialValue, {
            id: null,
            currency: program ? program.currency : null,
            balance: partialValue.balanceRule || (program && program.balanceRule) ? null : 0,
            usesRemaining: null,
            programId: program ? program.id : null,
            issuanceId: null,
            code: null,
            isGenericCode: false,
            genericCodeProperties: partialValue.genericCodeProperties ? partialValue.genericCodeProperties : undefined,
            attachedFromGenericValueId: null,
            contactId: null,
            pretax: program ? program.pretax : false,
            active: program ? program.active : true,
            canceled: false,
            frozen: false,
            discount: program ? program.discount : false,
            discountSellerLiability: program ? program.discountSellerLiability : null,
            redemptionRule: program ? program.redemptionRule : null,
            balanceRule: program ? program.balanceRule : null,
            startDate: program ? program.startDate : null,
            endDate: program ? program.endDate : null,
            metadata: {},
            createdDate: now,
            updatedDate: now,
            updatedContactIdDate: partialValue.contactId ? now : null,
            createdBy: auth.teamMemberId ? auth.teamMemberId : auth.userId,
        });

        value.metadata = {...(program && program.metadata ? program.metadata : {}), ...value.metadata};

        if (generateCodeParameters) {
            checkCodeParameters(generateCodeParameters, value.code, value.isGenericCode);
            value.code = generateCodeParameters ? generateCode(generateCodeParameters) : value.code;
        }
        if (value.code && value.isGenericCode == null) {
            value.isGenericCode = false;
        }

        checkValueProperties(value, program);
        return value;
    }

    export function checkValueProperties(value: Value, program: Program = null): void {
        if (program) {
            checkProgramConstraints(value, program);
        }

        if (value.balance != null && value.balanceRule) {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Value can't have both a balance and balanceRule.`);
        }
        if (value.discountSellerLiability !== null && !value.discount) {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Value can't have discountSellerLiability if it is not a discount.`);
        }
        if (value.contactId && value.isGenericCode) {
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, "A Value with isGenericCode=true cannot have contactId set.");
        }
        if (value.endDate && value.startDate > value.endDate) {
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, "Property startDate cannot exceed endDate.");
        }
        if (!value.currency) {
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, "Property currency cannot be null. Please provide a currency or a programId.");
        }

        // generic value checks
        if (value.genericCodeProperties && value.genericCodeProperties.valuePropertiesPerContact.balance != null && value.balanceRule) {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Value can't have both a genericCodeProperties.valuePropertiesPerContact.balance and balanceRule.`);
        }
        if (value.balance == null && value.balanceRule == null && (value.genericCodeProperties && value.genericCodeProperties.valuePropertiesPerContact.balance == null)) {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Value must have a balanceRule, a balance, or a genericCodeProperties.valuePropertiesPerContact.balance.`);
        }

        checkRulesSyntax(value, "Value");
    }


    function checkProgramConstraints(value: Value, program: Program): void {
        if (program.fixedInitialBalances && (program.fixedInitialBalances.indexOf(value.balance) === -1 || value.balance === null)) {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `Value's balance ${value.balance} is outside fixedInitialBalances defined by Program ${program.fixedInitialBalances}.`);
        }
        if (program.minInitialBalance !== null && (value.balance < program.minInitialBalance || value.balance === null)) {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `Value's balance ${value.balance} is less than minInitialBalance ${program.minInitialBalance}.`);
        }
        if (program.maxInitialBalance !== null && (value.balance > program.maxInitialBalance || value.balance === null)) {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `Value's balance ${value.balance} is greater than maxInitialBalance ${program.maxInitialBalance}.`);
        }

        if (program.fixedInitialUsesRemaining && (program.fixedInitialUsesRemaining.indexOf(value.usesRemaining) === -1 || !value.usesRemaining)) {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `Value's usesRemaining ${value.usesRemaining} outside fixedInitialUsesRemaining defined by Program ${program.fixedInitialUsesRemaining}.`);
        }

        if (program.currency !== value.currency) {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `Value's currency ${value.currency} cannot differ from currency of Program ${program.currency}.`);
        }
    }

    export function checkCodeParameters(generateCode: GenerateCodeParameters, code: string, isGenericCode: boolean): void {
        if (generateCode && (code || isGenericCode)) {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Parameter generateCode is not allowed with parameters code or isGenericCode:true.`);
        }
    }
}
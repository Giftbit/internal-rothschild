import * as cassava from "cassava";
import {installContactsRest} from "./contacts";
import {installValuesRest} from "./values";
import {installCurrenciesRest} from "./currencies";
import {installTransactionsRest} from "./transactions/transactions";
import {installValueTemplatesRest} from "./programs";
import {installContactValuesRest} from "./contactValues";
import {installIssuancesRest} from "./programIssuance";

/**
 * Install all the rest api routes.
 */
export function installRestRoutes(router: cassava.Router): void {
    installCurrenciesRest(router);
    installContactsRest(router);
    installContactValuesRest(router);
    installValuesRest(router);
    installTransactionsRest(router);
    installValueTemplatesRest(router);
    installIssuancesRest(router);
}

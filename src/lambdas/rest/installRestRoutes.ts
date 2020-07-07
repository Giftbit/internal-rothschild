import * as cassava from "cassava";
import {installContactsRest} from "./contacts";
import {installValuesRest} from "./values/values";
import {installCurrenciesRest} from "./currencies";
import {installTransactionsRest} from "./transactions/transactions";
import {installContactValuesRest} from "./contactValues";
import {installProgramsRest} from "./programs";
import {installIssuancesRest} from "./programIssuance";
import {installReportsRest} from "./reports/reports";
import {installSharedGenericMigration} from "./sharedGenericCodeMigration";

/**
 * Install all the rest api routes.
 */
export function installRestRoutes(router: cassava.Router): void {
    installCurrenciesRest(router);
    installContactsRest(router);
    installContactValuesRest(router);
    installValuesRest(router);
    installTransactionsRest(router);
    installProgramsRest(router);
    installIssuancesRest(router);
    installReportsRest(router);

    // temporary
    installSharedGenericMigration(router);
}

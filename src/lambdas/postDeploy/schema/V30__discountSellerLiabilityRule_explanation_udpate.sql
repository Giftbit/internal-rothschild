SET SQL_SAFE_UPDATES = 0;

UPDATE rothschild.`Values`
SET discountSellerLiabilityRule = CONCAT('{"rule":"',
                                         CAST(SUBSTR(discountSellerLiabilityRule,
                                                     LOCATE('"rule":"', discountSellerLiabilityRule) + 8,
                                                     (LOCATE('",', discountSellerLiabilityRule) -
                                                      (LOCATE('"rule":"', discountSellerLiabilityRule) + 8)))
                                              AS CHAR),
                                         CONCAT('", "explanation":"Seller ',
                                                CAST(SUBSTR(discountSellerLiabilityRule,
                                                            LOCATE('"rule":"', discountSellerLiabilityRule) + 8,
                                                            (LOCATE('",', discountSellerLiabilityRule) -
                                                             (LOCATE('"rule":"', discountSellerLiabilityRule) + 8))) *
                                                     100
                                                     AS CHAR),
                                                '% liable"}'))
WHERE discountSellerLiabilityRule IS NOT NULL
  AND discountSellerLiabilityRule LIKE '%Populated from deprecated property discountSellerLiability.%';

SET SQL_SAFE_UPDATES = 1;
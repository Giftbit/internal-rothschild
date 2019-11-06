SET SQL_SAFE_UPDATES = 0;

UPDATE rothschild.`Values`
SET discountSellerLiabilityRule = CONCAT('{"rule":"',
                                         CAST(SUBSTR(discountSellerLiabilityRule,
                                                     LOCATE('"rule":', discountSellerLiabilityRule) + 8,
                                                     LOCATE('"explanation":',
                                                            discountSellerLiabilityRule) -
                                                     (LOCATE('"rule":', discountSellerLiabilityRule) + 10))
                                              AS CHAR),
                                         CONCAT('", "explanation":"Seller ',
                                                CAST(SUBSTR(discountSellerLiabilityRule,
                                                            LOCATE('"rule":', discountSellerLiabilityRule) + 8,
                                                            LOCATE('"explanation":',
                                                                   discountSellerLiabilityRule) -
                                                            (LOCATE('"rule":', discountSellerLiabilityRule) + 10)) * 100
                                                     AS CHAR),
                                                '% liable"}'))
WHERE discountSellerLiabilityRule IS NOT NULL
  AND SUBSTR(discountSellerLiabilityRule,
             LOCATE('"explanation":',
                    discountSellerLiabilityRule) + 15,
             LOCATE('}', discountSellerLiabilityRule) - (LOCATE('"explanation":',
                                                                discountSellerLiabilityRule) + 16)) =
      'Populated from deprecated property discountSellerLiability.';

SET SQL_SAFE_UPDATES = 1;
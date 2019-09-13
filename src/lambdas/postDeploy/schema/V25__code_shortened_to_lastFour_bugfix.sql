SET SQL_SAFE_UPDATES = 0;

UPDATE rothschild.`LightrailTransactionSteps` LTS
JOIN rothschild.`Transactions` T
ON LTS.transactionId = T.id AND LTS.userId = T.userId
SET LTS.code = CONCAT('…', SUBSTR(LTS.code, GREATEST(LENGTH(LTS.code) * -1, -4)))
WHERE LTS.code IS NOT NULL
  AND T.transactionType = 'initialBalance';

SET SQL_SAFE_UPDATES = 1;
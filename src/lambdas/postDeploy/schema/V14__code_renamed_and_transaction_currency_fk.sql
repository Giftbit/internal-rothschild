SET SQL_SAFE_UPDATES = 0;

ALTER TABLE rothschild.`Values`
  CHANGE code codeLastFour NVARCHAR(255);

UPDATE rothschild.`Values`
SET codeLastFour = SUBSTR(codeLastFour, 2)
WHERE codeLastFour IS NOT NULL;

ALTER TABLE rothschild.Transactions
  ADD CONSTRAINT fk_Transaction_Currencies FOREIGN KEY (userId, currency) REFERENCES rothschild.Currencies (userId, code);

SET SQL_SAFE_UPDATES = 1;

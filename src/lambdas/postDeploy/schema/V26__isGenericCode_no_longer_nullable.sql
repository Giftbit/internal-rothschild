SET SQL_SAFE_UPDATES = 0;

UPDATE rothschild.`Values` V
SET V.isGenericCode = FALSE
WHERE V.isGenericCode IS NULL;

SET SQL_SAFE_UPDATES = 1;

ALTER TABLE rothschild.`Values`
  MODIFY `isGenericCode` BOOL NOT NULL;
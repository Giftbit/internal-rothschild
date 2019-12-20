ALTER TABLE rothschild.Currencies
    ADD COLUMN createdDate DATETIME,
    ADD COLUMN updatedDate DATETIME,
    ADD COLUMN createdBy   VARCHAR(64);

SET SQL_SAFE_UPDATES = 0;

set @Now = NOW();
UPDATE rothschild.Currencies
SET createdBy   = userId,
    createdDate = @Now,
    updatedDate = @Now;

SET SQL_SAFE_UPDATES = 1;

ALTER TABLE rothschild.Currencies
    MODIFY COLUMN createdDate DATETIME NOT NULL,
    MODIFY COLUMN updatedDate DATETIME NOT NULL,
    MODIFY COLUMN createdBy VARCHAR(64) NOT NULL;

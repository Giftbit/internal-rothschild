ALTER DATABASE rothschild DEFAULT COLLATE utf8mb4_unicode_ci;

# Foreign keys require two columns to have the same collation.  We can only change them
# safely if we drop the foreign key and then recreate it.  Or we can do this dangerous
# thing and just be really careful.
SET FOREIGN_KEY_CHECKS = 0;

ALTER TABLE rothschild.`ContactValues`
    MODIFY COLUMN userId VARCHAR(64) CHARACTER SET ascii NOT NULL COLLATE ascii_bin,
    MODIFY COLUMN valueId VARCHAR(64) CHARACTER SET ascii NULL COLLATE ascii_bin,
    MODIFY COLUMN contactId VARCHAR(64) CHARACTER SET ascii NULL COLLATE ascii_bin;

ALTER TABLE rothschild.`Contacts`
    MODIFY COLUMN userId VARCHAR(64) CHARACTER SET ascii NOT NULL COLLATE ascii_bin,
    MODIFY COLUMN id VARCHAR(64) CHARACTER SET ascii NULL COLLATE ascii_bin;

ALTER TABLE rothschild.`Currencies`
    MODIFY COLUMN userId VARCHAR(64) CHARACTER SET ascii NOT NULL COLLATE ascii_bin,
    MODIFY COLUMN code VARCHAR(16) CHARACTER SET ascii NOT NULL COLLATE ascii_bin;

ALTER TABLE rothschild.`InternalTransactionSteps`
    MODIFY COLUMN userId VARCHAR(64) CHARACTER SET ascii NOT NULL COLLATE ascii_bin,
    MODIFY COLUMN id VARCHAR(96) NOT NULL COLLATE ascii_bin,
    MODIFY COLUMN transactionId VARCHAR(64) CHARACTER SET ascii NOT NULL COLLATE ascii_bin,
    MODIFY COLUMN internalId VARCHAR(255) CHARACTER SET ascii NOT NULL COLLATE ascii_bin,
    DROP FOREIGN KEY fk_InternalTransactionSteps_Transactions;

ALTER TABLE rothschild.`Issuances`
    MODIFY COLUMN userId VARCHAR(64) CHARACTER SET ascii NOT NULL COLLATE ascii_bin,
    MODIFY COLUMN id VARCHAR(64) CHARACTER SET ascii NULL COLLATE ascii_bin,
    MODIFY COLUMN programId VARCHAR(64) CHARACTER SET asciiNOT NULL COLLATE ascii_bin;

ALTER TABLE rothschild.`LightrailTransactionSteps`
    MODIFY COLUMN userId VARCHAR(64) CHARACTER SET ascii NOT NULL COLLATE ascii_bin,
    MODIFY COLUMN id VARCHAR(96) CHARACTER SET ascii NULL COLLATE ascii_bin,
    MODIFY COLUMN valueId VARCHAR(64) CHARACTER SET ascii NOT NULL COLLATE ascii_bin,
    MODIFY COLUMN contactId VARCHAR(64) CHARACTER SET ascii DEFAULT NULL COLLATE ascii_bin,
    MODIFY COLUMN transactionId VARCHAR(64) CHARACTER SET ascii NOT NULL COLLATE ascii_bin;

ALTER TABLE rothschild.`Programs`
    MODIFY COLUMN userId VARCHAR(64) CHARACTER SET ascii NOT NULL COLLATE ascii_bin,
    MODIFY COLUMN id VARCHAR(64) CHARACTER SET ascii NULL COLLATE ascii_bin,
    MODIFY COLUMN currency VARCHAR(16) CHARACTER SET ascii NOT NULL COLLATE ascii_bin;

ALTER TABLE rothschild.`StripeTransactionSteps`
    MODIFY COLUMN userId VARCHAR(64) CHARACTER SET ascii NOT NULL COLLATE ascii_bin,
    MODIFY COLUMN id VARCHAR(96) CHARACTER SET ascii NULL COLLATE ascii_bin,
    MODIFY COLUMN transactionId VARCHAR(64) CHARACTER SET ascii NOT NULL COLLATE ascii_bin,
    MODIFY COLUMN chargeId VARCHAR(255) CHARACTER SET ascii NOT NULL COLLATE ascii_bin;

ALTER TABLE rothschild.`TransactionChainBlockers`
    MODIFY COLUMN userId VARCHAR(64) CHARACTER SET ascii NOT NULL COLLATE ascii_bin,
    MODIFY COLUMN transactionId VARCHAR(64) NOT NULL COLLATE ascii_bin;

ALTER TABLE rothschild.`Transactions`
    MODIFY COLUMN userId VARCHAR(64) CHARACTER SET ascii NOT NULL COLLATE ascii_bin,
    MODIFY COLUMN id VARCHAR(64) CHARACTER SET ascii NULL COLLATE ascii_bin,
    MODIFY COLUMN currency VARCHAR(16) CHARACTER SET ascii NOT NULL COLLATE ascii_bin,
    MODIFY COLUMN rootTransactionId VARCHAR(64) CHARACTER SET ascii NOT NULL COLLATE ascii_bin,
    MODIFY COLUMN nextTransactionId VARCHAR(64) DEFAULT NULL COLLATE ascii_bin;

ALTER TABLE rothschild.`Values`
    MODIFY COLUMN userId VARCHAR(64) CHARACTER SET ascii NOT NULL COLLATE ascii_bin,
    MODIFY COLUMN id VARCHAR(64) CHARACTER SET ascii NULL COLLATE ascii_bin,
    MODIFY COLUMN currency VARCHAR(16) CHARACTER SET ascii NOT NULL COLLATE ascii_bin,
    MODIFY COLUMN contactId VARCHAR(64) CHARACTER SET ascii DEFAULT NULL COLLATE ascii_bin,
    MODIFY COLUMN programId VARCHAR(64) CHARACTER SET ascii DEFAULT NULL COLLATE ascii_bin,
    MODIFY COLUMN issuanceId VARCHAR(64) CHARACTER SET ascii DEFAULT NULL COLLATE ascii_bin,
    MODIFY COLUMN attachedFromValueId VARCHAR(64) CHARACTER SET ascii DEFAULT NULL COLLATE ascii_bin;

SET FOREIGN_KEY_CHECKS = 1;

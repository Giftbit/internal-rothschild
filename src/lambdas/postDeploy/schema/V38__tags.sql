CREATE TABLE rothschild.Tags
(
    userId      VARCHAR(64)                       NOT NULL,
    id          VARCHAR(64)                       NOT NULL,
    name        VARCHAR(96) CHARACTER SET utf8mb4,
    createdDate DATETIME                          NOT NULL,
    updatedDate DATETIME                          NOT NULL,
    createdBy   VARCHAR(64) COLLATE ascii_bin     NOT NULL,
    PRIMARY KEY pk_Tags (userId, id),
    UNIQUE INDEX uq_ix_Tags_name (userId, name)
);

CREATE TABLE rothschild.TransactionsTags
(
    userId        VARCHAR(64) NOT NULL,
    transactionId VARCHAR(64) NOT NULL,
    tagId         VARCHAR(64) NOT NULL,
    PRIMARY KEY pk_TransactionsTags (userId, transactionId, tagId),
    CONSTRAINT fk_TransactionsTags_Transactions FOREIGN KEY (userId, transactionId) REFERENCES rothschild.Transactions (userId, id),
    CONSTRAINT fk_TransactionsTags_Tags FOREIGN KEY (userId, tagId) REFERENCES rothschild.Tags (userId, id)
);

ALTER TABLE rothschild.ValueTags
    RENAME TO rothschild.ValuesTags,
    DROP INDEX ix_ValueTags_tag,
    DROP COLUMN tag,
    ADD COLUMN tagId VARCHAR(64) NOT NULL,
    ADD CONSTRAINT FOREIGN KEY fk_ValuesTags_Values (userId, valueId) REFERENCES rothschild.Values (userId, id),
    ADD CONSTRAINT FOREIGN KEY fk_ValuesTags_Tags (userId, tagId) REFERENCES rothschild.Tags (userId, id);

ALTER TABLE rothschild.ProgramTags
    RENAME TO rothschild.ProgramsTags,
    DROP INDEX ix_ProgramTags_tag,
    DROP COLUMN tag,
    ADD COLUMN tagId VARCHAR(64) NOT NULL,
    ADD CONSTRAINT FOREIGN KEY fk_ProgramsTags_Programs (userId, programId) REFERENCES rothschild.Programs (userId, id),
    ADD CONSTRAINT FOREIGN KEY fk_ProgramsTags_Tags (userId, tagId) REFERENCES rothschild.Tags (userId, id);

ALTER TABLE rothschild.Values
    ADD INDEX ix_Values_programId_createdDate (userId, programId, createdDate);

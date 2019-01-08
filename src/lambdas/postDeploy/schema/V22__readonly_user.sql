CREATE USER 'readonly'@'%' IDENTIFIED BY '${readonlyuserpassword}';

GRANT SELECT ON rothschild.* TO 'readonly'@'%';
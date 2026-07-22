# Third-Party Notices

`jdbc-agent` bundles the official JDBC drivers below as separate, unmodified jars in
`build/libs/lib/` (see `build.gradle`'s `copyRuntimeLibs` task). None of their source is
vendored or embedded into this project's own Java sources — they're loaded at runtime purely
through the standard `java.sql.Driver` / `DriverManager` SPI, referenced via the launcher jar's
manifest `Class-Path`.

| Driver | Coordinates | License |
| --- | --- | --- |
| Oracle JDBC (ojdbc11) | `com.oracle.database.jdbc:ojdbc11` | Oracle Free Use Terms and Conditions |
| Oracle Globalization Support | `com.oracle.database.nls:orai18n` | Oracle Free Use Terms and Conditions |
| Microsoft JDBC Driver for SQL Server (mssql-jdbc) | `com.microsoft.sqlserver:mssql-jdbc` | MIT License |
| MySQL Connector/J | `com.mysql:mysql-connector-j` | GPLv2 with Universal FOSS Exception 1.0 |
| protobuf-java (MySQL Connector/J dependency) | `com.google.protobuf:protobuf-java` | BSD 3-Clause |
| MariaDB Connector/J | `org.mariadb.jdbc:mariadb-java-client` | LGPL-2.1-or-later |
| PostgreSQL JDBC Driver (pgJDBC) | `org.postgresql:postgresql` | BSD-2-Clause |
| checker-qual (pgJDBC dependency) | `org.checkerframework:checker-qual` | MIT License |
| Jackson Databind | `com.fasterxml.jackson.core:jackson-databind` (+ core, annotations) | Apache License 2.0 |

## MySQL Connector/J (GPLv2 + Universal FOSS Exception)

MySQL Connector/J is the only bundled driver under a copyleft license. Two things keep this safe
for Silk Studio's own (differently licensed) code:

1. **No linking/derivation** — `jdbc-agent`'s own classes never subclass, copy, or otherwise
   derive from Connector/J source; the only interaction is calling standard `java.sql` interfaces
   that Connector/J happens to implement.
2. **Universal FOSS Exception** — Oracle's license for Connector/J explicitly grants an
   additional permission to link the driver with separately licensed software (see the
   [driver's own LICENSE](https://github.com/mysql/mysql-connector-j/blob/HEAD/LICENSE) and the
   [Universal FOSS Exception 1.0](http://oss.oracle.com/licenses/universal-foss-exception) text).

**Distribution policy:** whenever `jdbc-agent-all.jar` + `build/libs/lib/` (or any future
installer/bundle built on top of it) is shipped outside this repo, keep
`mysql-connector-j-*.jar` unmodified and alongside its own license/notice — do not merge its
classes into a single fat jar with our own code (this also matches why the build already ships a
thin jar + external `lib/`, see the comment in `build.gradle`). If a future packaging step
(e.g. a Tauri installer bundling `jdbc-agent`) redistributes this jar to end users, include a
copy of, or a link to, the Connector/J license text alongside the installer.

## MariaDB Connector/J (LGPL-2.1-or-later)

MariaDB Connector/J is a separate official driver from MySQL Connector/J (own Maven coordinates,
own frontend `mariadb` driver id, own `jdbc:mariadb:` URL scheme). It is licensed
[LGPL-2.1-or-later](https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html). Like the MySQL
driver above:

1. **No linking/derivation of source** — `jdbc-agent` only talks to it through standard
   `java.sql` interfaces; its classes are never subclassed or copied into this project's sources.
2. **Unmodified separate jar** — it ships as `mariadb-java-client-*.jar` under `build/libs/lib/`
   and is referenced via the launcher jar's manifest `Class-Path`. Do not merge its classes into
   a fat jar with our own code.

By default MariaDB Connector/J only registers for `jdbc:mariadb:` URLs (accepting `jdbc:mysql:`
requires an explicit `permitMysqlScheme` option which this app never sets), so it cannot shadow
`mysql-connector-j` on the same classpath.

## PostgreSQL JDBC Driver (BSD-2-Clause)

pgJDBC (`org.postgresql:postgresql`) is licensed under
[BSD-2-Clause](https://jdbc.postgresql.org/about/license.html). It ships unmodified as
`postgresql-*.jar` under `build/libs/lib/` and is loaded only through standard `java.sql`
interfaces — same packaging rules as the other drivers above (thin launcher jar + external
`lib/`, no class merging).

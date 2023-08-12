/* eslint-disable no-console */
import { IColumn } from "../../decorators/IColumn.js";
import { IIndex } from "../../decorators/IIndex.js";
import { BaseConnection, BaseDriver } from "../../drivers/base/BaseDriver.js";
import EntityType from "../../entity-query/EntityType.js";
import EntityContext from "../../model/EntityContext.js";
import MysqlMigrations from "./MysqlMigrations.js";

export default class MysqlAutomaticMigrations extends MysqlMigrations {

    async migrateTable(context: EntityContext, type: EntityType) {

        console.log(`Migrating ${type.name}.`);

        // create table if not exists...
        const nonKeyColumns = type.nonKeys;
        const keys = type.keys;

        const driver = context.connection;

        await this.createTable(driver, type, keys);

        await this.createColumns(driver, type, nonKeyColumns);

        await this.createIndexes(context, type, nonKeyColumns.filter((x) => x.fkRelation && !x.fkRelation?.dotNotCreateIndex));

        console.log(`${type.name} Migrated.`);

    }

    async createIndexes(context: EntityContext, type: EntityType, fkColumns: IColumn[]) {
        for (const iterator of fkColumns) {
            const filter = iterator.nullable
                ? `${iterator.columnName} IS NOT NULL`
                : "";
            const indexDef: IIndex = {
                name: `IX_${type.name}_${iterator.columnName}`,
                columns: [{ name: iterator.columnName, descending: iterator.indexOrder !== "ascending"}],
                filter
            };
            await this.migrateIndex(context, indexDef, type);
        }
    }

    async createColumns(driver: BaseConnection, type: EntityType, nonKeyColumns: IColumn[]) {

        const name = type.schema
        ? type.schema + "." + type.name
        : type.name;

        if (nonKeyColumns.length > 1) {
            nonKeyColumns.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        }

        for (const iterator of nonKeyColumns) {

            if(await this.exists(driver, {
                from: "INFORMATION_SCHEMA.COLUMNS",
                where: {
                    "TABLE_SCHEMA": driver.driver.connectionString.database,
                    "COLUMN_NAME": iterator.columnName,
                    "TABLE_NAME": type.name
                }
            })) {
                continue;
            }
            const columnName = iterator.columnName;
            let def = `ALTER TABLE ${name} ADD COLUMN ${columnName} `;
            def += this.getColumnDefinition(iterator);
            if (iterator.nullable !== true) {
                def += " NOT NULL ";
            }
            if (typeof iterator.default === "string") {
                def += " DEFAULT " + iterator.default;
            }
            await driver.executeQuery(def + ";");
        }

    }

    async createTable(driver: BaseConnection, type: EntityType, keys: IColumn[]) {

        const name = type.schema
            ? type.schema + "." + type.name
            : type.name;

        if (keys.length > 1) {
            keys.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        }

        const fields = [];

        for (const iterator of keys) {
            let def = `${iterator.columnName} `;
            if (iterator.autoGenerate) {
                def += iterator.dataType === "BigInt" ? "BIGINT " : "INT ";
            } else {
                def += this.getColumnDefinition(iterator);
            }
            def += " not null primary key\r\n\t";
            if (iterator.autoGenerate) {
                def +=  " AUTO_INCREMENT";
            }
            fields.push(def);
        }

        await driver.executeQuery(`CREATE TABLE IF NOT EXISTS ${name} (${fields.join(",")})`);

    }

    async migrateIndex(context: EntityContext, index: IIndex, type: EntityType) {
        const driver = context.connection;
        const name = type.schema
        ? type.schema + "." + type.name
        : type.name;
        const indexName =  index.name;

        if (await this.exists(driver, {
            from: "information_schema.statistics",
            where: {
                "table_schema": context.driver.connectionString.database,
                "table_name": type.name,
                "index_name": indexName
            }
        })) {
            return;
        }

        const columns = [];
        for (const column of index.columns) {
            const columnName = column.name;
            columns.push(`${columnName} ${column.descending ? "DESC" : "ASC"}`);
        }
        let query = `CREATE ${index.unique ? "UNIQUE" : ""} INDEX ${indexName} ON ${name} ( ${columns.join(", ")})`;
        if (index.filter) {
            query += ` WHERE (${index.filter})`;
        }
        await driver.executeQuery(query);
    }

    async exists(driver: BaseConnection, { from, where }) {
        const values = [];
        let test = "";
        for (const key in where) {
            if (Object.prototype.hasOwnProperty.call(where, key)) {
                const element = where[key];
                test = test
                    ? `${test} AND ${key}=$${values.length+1}`
                    : `${key}=$${values.length+1}`;
                values.push(element);
            }
        }
        const text = `SELECT 1 FROM ${from} WHERE ${test}`;
        const result = await driver.executeQuery({ text, values });
        return result?.rows?.length > 0;
    }


}
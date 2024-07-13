/* eslint-disable no-console */
import ICheckConstraint from "../../decorators/ICheckConstraint.js";
import { IColumn } from "../../decorators/IColumn.js";
import { IForeignKeyConstraint } from "../../decorators/IForeignKeyConstraint.js";
import { IIndex } from "../../decorators/IIndex.js";
import { BaseConnection, BaseDriver } from "../../drivers/base/BaseDriver.js";
import EntityType from "../../entity-query/EntityType.js";
import EntityContext from "../../model/EntityContext.js";
import Migrations from "../Migrations.js";
import PostgresMigrations from "./PostgresMigrations.js";

export default class PostgresAutomaticMigrations extends PostgresMigrations {

    async ensureVersionTable(context: EntityContext, table: string) {
        await context.connection.executeQuery(`CREATE TABLE IF NOT EXISTS ${table}(
            "version" CHAR(200) NOT NULL,
            "dateCreated" TIMESTAMP DEFAULT NOW(),
            constraint PK_MigrationTable_Version PRIMARY KEY ("version")
        )`);
    }

    async migrateTable(context: EntityContext, type: EntityType) {


        // create table if not exists...
        const nonKeyColumns = type.nonKeys;
        const keys = type.keys;

        const driver = context.connection;

        await this.createTable(driver, type, keys);

        await this.createColumns(driver, type, nonKeyColumns);

        await this.createIndexes(context, type, nonKeyColumns.filter((x) =>
            x.fkRelation
            && (!x.key || type.keys.indexOf(x) !== 0)
            && !x.fkRelation?.doNotCreateIndex));

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
            const columnName = iterator.columnName;
            let def = `ALTER TABLE ${name} ADD COLUMN IF NOT EXISTS ${columnName} `;
            def += this.getColumnDefinition(iterator);

            if (iterator.nullable !== true) {
                def += " NOT NULL ";
            }

            if (iterator.generated === "computed") {
                def += ` GENERATED ALWAYS AS (${iterator.computed}) ${iterator.stored ? "STORED" : ""} \r\n\t`;
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
            let def = iterator.columnName + " ";
            if (iterator.generated) {
                switch(iterator.generated) {
                    case "identity":
                        def += iterator.dataType === "BigInt" ? "bigint " : "int ";
                        def += " not null GENERATED BY DEFAULT AS IDENTITY\r\n\t";
                        break;
                    case "computed":
                        def += ` not null GENERATED ALWAYS AS (${iterator.computed}) ${iterator.stored ? "STORED" : ""} \r\n\t`;
                        break;
                }
            } else {
                def += this.getColumnDefinition(iterator);
                def += " not null \r\n\t";
            }
            fields.push(def);
        }

        await driver.executeQuery(`CREATE TABLE IF NOT EXISTS ${name} (${fields.join(",")}
        ,CONSTRAINT PK_${name} PRIMARY KEY (${keys.map((x) => x.columnName).join(",")})
        )`);

    }

    async migrateIndex(context: EntityContext, index: IIndex, type: EntityType) {
        const driver = context.connection;
        const name = type.schema
        ? type.schema + "." + type.name
        : type.name;
        const indexName =  index.name;
        const columns = [];
        for (const column of index.columns) {
            const columnName = column.name;
            columns.push(`${columnName} ${column.descending ? "DESC" : "ASC"}`);
        }
        let query = `CREATE ${index.unique ? "UNIQUE" : ""} INDEX IF NOT EXISTS ${indexName} ON ${name} ( ${columns.join(", ")})`;
        if (index.filter) {
            query += ` WHERE (${index.filter})`;
        }
        await driver.executeQuery(query);
    }

    async constraintExists(context: EntityContext, name: string, schema: string, table = "referential_constraints") {

        let text = `SELECT * FROM information_schema.${table}
        WHERE lower(constraint_name)=lower($1)`;

        const values = [name];

        if(schema) {
            text += " and constraint_schema = $2";
            values.push(schema);
        }

        const driver = context.connection;

        const r = await driver.executeQuery({ text, values });
        if (r.rows?.length) {
            return true;
        }
        return false;
    }

    async migrateForeignKey(context: EntityContext, constraint: IForeignKeyConstraint) {
        const { type } = constraint;
        const name = type.schema
        ? type.schema + "." + type.name
        : type.name;

        if (await this.constraintExists(context, constraint.name, type.schema)) {
            return;
        }

        const driver = context.connection;

        let text = `ALTER TABLE ${name} ADD CONSTRAINT ${constraint.name} 
            foreign key (${constraint.fkMap.map((r) => `${r.fkColumn.columnName}`).join(",")})
            references ${constraint.fkMap[0].relatedKeyColumn.entityType.name}(
                ${constraint.fkMap.map((x) => x.relatedKeyColumn.columnName).join(",")}
            ) `;

        switch(constraint.cascade) {
            case "delete":
                text += " ON DELETE CASCADE";
                break;
            case "set-null":
                text += " ON DELETE SET NULL";
                break;
            case "set-default":
                text += " ON DELETE SET DEFAULT";
                break;
            case "restrict":
                text += " ON DELETE RESTRICT";
                break;
        }

        try {
            await driver.executeQuery(text);
        } catch (error) {
            // we will simply ignore this
            console.warn(`Failed adding constraint ${constraint.name}`);
            console.warn(error);
        }

    }

    async migrateCheckConstraint(context: EntityContext, constraint: ICheckConstraint<any>, type: EntityType) {
        if (await this.constraintExists(context, constraint.name, type.schema, "check_constraints")) {
            return;
        }

        const name = type.schema
        ? type.schema + "." + type.name
        : type.name;


        const driver = context.connection;

        const text = `ALTER TABLE ${name} ADD CONSTRAINT ${constraint.name} CHECK (${constraint.filter})`;

        try {
            await driver.executeQuery(text);
        } catch (error) {
            // we will simply ignore this
            console.warn(`Failed adding constraint ${constraint.name}`);
            console.warn(error);
        }
    }


}

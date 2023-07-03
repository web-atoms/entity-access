import QueryCompiler from "../../compiler/QueryCompiler.js";
import EntityType from "../../entity-query/EntityType.js";
import Migrations from "../../migrations/Migrations.js";
import { Constant, Expression, InsertStatement, QuotedLiteral, ReturnUpdated, TableLiteral, ValuesStatement } from "../../query/ast/Expressions.js";

const disposableSymbol: unique symbol = (Symbol as any).dispose ??= Symbol("disposable");

interface IDisposable {
    [disposableSymbol]?(): void;
}

export interface IRecord {
    [key: string]: string | boolean | number | Date | Uint8Array | Blob;
}

export interface IDbConnectionString {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
}

export interface IDbReader extends IDisposable {
    next(min?: number, signal?: AbortSignal): AsyncGenerator<IRecord, any, any>;
    dispose(): Promise<any>;
}

export const toQuery = (text: IQuery): { text: string, values?: any[]} => typeof text === "string"
    ? { text, values: [] }
    : text;

export type IQuery = string | {
    text: string;
    values?: any[];
};

export interface IQueryTask {
    query: IQuery;
    postExecution?: ((r: any) => Promise<any>);
}

export abstract class BaseDriver {

    abstract get compiler(): QueryCompiler;

    constructor(public readonly connectionString: IDbConnectionString) {}

    public abstract escape(name: string);

    public abstract executeReader(command: IQuery, signal?: AbortSignal): Promise<IDbReader>;

    public abstract executeNonQuery(command: IQuery, signal?: AbortSignal): Promise<any>;

    public abstract ensureDatabase(): Promise<any>;

    public abstract runInTransaction<T = any>(fx?: () => Promise<T>): Promise<T>;

    /**
     * This migrations only support creation of missing items.
     * However, you can provide events to change existing items.
     */
    public abstract automaticMigrations(): Migrations;

    createInsertExpression(type: EntityType, entity: any): InsertStatement {
        const returnFields = [] as QuotedLiteral[];
        const fields = [] as QuotedLiteral[];
        const values = [] as Constant[];
        for (const iterator of type.columns) {
            const literal = QuotedLiteral.create({ literal: iterator.columnName });
            if (iterator.autoGenerate) {
                returnFields.push(literal);
                continue;
            }
            const value = entity[iterator.name];
            if (value === void 0) {
                continue;
            }
            fields.push(literal);
            values.push(Constant.create({ value }));
        }

        const name = QuotedLiteral.create({ literal: type.name });
        const schema = type.schema ? QuotedLiteral.create({ literal: type.schema }) : void 0;

        return InsertStatement.create({
            table: TableLiteral.create({
                name,
                schema
            }),
            values: ValuesStatement.create({ fields, values: [values] }),
            returnValues: ReturnUpdated.create({
                changes: "INSERTED",
                fields: returnFields
            }),
        });
    }

}

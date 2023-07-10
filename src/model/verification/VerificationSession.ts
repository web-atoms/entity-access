import EntityAccessError from "../../common/EntityAccessError.js";
import { IEntityRelation } from "../../decorators/IColumn.js";
import EntityType from "../../entity-query/EntityType.js";
import { ConditionalExpression, Constant, ExistsExpression, Expression, Identifier, ParameterExpression, QuotedLiteral, SelectStatement, TemplateLiteral, ValuesStatement } from "../../query/ast/Expressions.js";
import EntityContext from "../EntityContext.js";
import EntityQuery from "../EntityQuery.js";
import ChangeEntry from "../changes/ChangeEntry.js";
import EntityEvents, { ForeignKeyFilter } from "../events/EntityEvents.js";

type KeyValueArray = [string, any][];

export default class VerificationSession {

    private select: SelectStatement;

    private field: Expression;

    constructor(private context: EntityContext) {
        const source = ValuesStatement.create({
            values: [
                [Identifier.create({ value: "1"})]
            ],
            as: QuotedLiteral.create({ literal: "a"})
        });
        this.select = SelectStatement.create({
            source
        });
    }

    queueVerification(change: ChangeEntry, events: EntityEvents<any>) {
        const { type, entity } = change;
        if (change.status !== "inserted") {
            // verify access to the entity
            const keys = [] as KeyValueArray;
            for (const iterator of type.keys) {
                const key = entity[iterator.name];
                if (key === void 0) {
                    break;
                }
                keys.push([iterator.columnName, key]);
            }
            if (keys.length === type.keys.length) {
                this.queueEntityKey(change, keys, events);
            }
        }

        if (change.status === "deleted") {
            return;
        }

        // for modified or inserted
        // we need to verify access to each foreign key

        for (const relation of type.relations) {
            if (relation.isCollection) {
                continue;
            }

            const fk = relation.fkColumn;
            if (!fk) {
                continue;
            }

            const fkValue = entity[fk.name];
            if (fkValue === void 0) {
                // not set... ignore..
                continue;
            }
            this.queueEntityForeignKey(change, relation, fkValue);
        }
    }
    queueEntityForeignKey(change: ChangeEntry, relation: IEntityRelation, value) {
        const relatedModel = relation.relatedEntity;
        const type = relation.relatedEntity.typeClass;
        const events = this.context.eventsFor(type);
        const context = this.context;
        const fk = new ForeignKeyFilter({
            context,
            events,
            type: relatedModel,
            name: relation.name,
            fkName: relation.fkColumn.name
        });
        const query = events.onForeignKeyFilter(fk);
        if (!query) {
            return;
        }

        const eq = query as EntityQuery;
        const compare = Expression.equal(
            Expression.member(eq.selectStatement.as, relatedModel.keys[0].columnName),
            Expression.constant(value)
        );
        this.addError(query as EntityQuery, compare , `Unable to access entity ${type} through foreign key ${change.type.name}.${relation.name}`);
    }

    queueEntityKey(change: ChangeEntry, keys: KeyValueArray, events: EntityEvents<any>) {
        const type = change.type.typeClass;
        let query = this.context.query(type);
        query = change.status === "modified" ? events.modify(query) : events.delete(query);
        if (!query) {
            return;
        }
        let compare: Expression;
        const eq = query as EntityQuery;
        for (const [key, value] of keys) {
            const test = Expression.equal(
                Expression.member(eq.selectStatement.as, Expression.quotedLiteral(key)),
                Expression.constant(value)
            );
            compare = compare
                ? Expression.logicalAnd(compare, test)
                : test;
        }
        this.addError(query  as EntityQuery, compare, `Unable to access entity ${type}`);
    }

    async verifyAsync(): Promise<any> {
        this.select.fields =[
            Expression.as(this.field, "error")
        ];
        this.select.as = ParameterExpression.create({ name: "x"});
        const compiler = this.context.driver.compiler;
        const query = compiler.compileExpression(null, this.select);
        const { rows: [ { error }]} = await this.context.driver.executeQuery(query);
        if (error) {
            EntityAccessError.throw(error);
        }
    }

    addError(query: EntityQuery, compare: Expression, error: string) {
        const select = { ... query.selectStatement};
        select.fields = [
            Expression.identifier("1")
        ];

        const where = select.where
            ? Expression.logicalAnd(select.where, compare)
            : compare;

        select.where = where;

        const text = ConditionalExpression.create({
            test: ExistsExpression.create({
                target: select
            }),
            consequent: Expression.constant(error),
            alternate: Expression.constant("")
        });

        if (this.field) {
            this.field = Expression.templateLiteral([this.field, text]);
        } else {
            this.field = text;
        }
    }
}

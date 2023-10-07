import { cloner } from "../../common/cloner.js";
import EntityType from "../../entity-query/EntityType.js";
import EntityContext from "../../model/EntityContext.js";
import EntityQuery from "../../model/EntityQuery.js";
import DebugStringVisitor from "../ast/DebugStringVisitor.js";
import { ArrowFunctionExpression, ExistsExpression, Expression, ExpressionType, JoinExpression, NumberLiteral, ParameterExpression, SelectStatement, TableSource } from "../ast/Expressions.js";
import ReplaceParameter from "../ast/ReplaceParameter.js";
import ArrowToExpression from "../parser/ArrowToExpression.js";
import { NotSupportedError } from "../parser/NotSupportedError.js";

export class QueryExpander {
    static expand(context: EntityContext, select: SelectStatement, p, filter: boolean) {
        const qe = new QueryExpander(context, select, filter);
        const expression = ArrowToExpression.transform(`(_____________________x) => ${p}` as any);
        qe.expandNode(select, select.model, expression.body as ExpressionType);
        return qe.include;
    }

    private include: SelectStatement[] = [];

    constructor(
        private context: EntityContext,
        private select: SelectStatement,
        private filter: boolean
    ) {

    }

    expandNode(parent: SelectStatement, model: EntityType, node: ExpressionType): [SelectStatement, EntityType] {

        parent = cloner.clone(parent);

        if (node.type === "ArrayExpression") {
            for (const iterator of node.elements) {
                this.expandNode(parent, model,  iterator as ExpressionType);
            }
            return;
        }

        if(node.type === "CallExpression") {
            const callee = node.callee as ExpressionType;
            if (callee.type !== "MemberExpression") {
                throw new NotSupportedError(callee.type);
            }
            const property = callee.property as ExpressionType;
            if (property.type !== "Identifier") {
                throw new NotSupportedError(property.type);
            }
            if (property.value !== "forEach") {
                throw new NotSupportedError(property.value);
            }
            const [expandedSelect, expandedType] = this.expandNode(parent, model, callee.target as ExpressionType);

            const arrow = node.arguments[0];
            if (!arrow || arrow.type !== "ArrowFunctionExpression") {
                throw new NotSupportedError(arrow?.type ?? "Empty Expression");
            }
            this.expandNode(expandedSelect, expandedType, (arrow as ArrowFunctionExpression).body as ExpressionType);
            return [expandedSelect, expandedType];
        }

        if (node.type !== "MemberExpression") {
            throw new NotSupportedError(node.type);
        }

        const p = node.property as ExpressionType;
        if (p.type !== "Identifier") {
            throw new NotSupportedError(p.type);
        }

        const target = node.target as ExpressionType;
        if (target.type === "MemberExpression") {
            const [mepSelect, mepType] = this.expandNode(parent, model, target);
            parent = mepSelect;
            model = mepType;
        }

        const mp = model.getProperty(p.value);
        if (!mp.relation) {
            throw new NotSupportedError(`No relation found ${p.value} in ${model.name}`);
        }
        const { relation } = mp;
        const { relatedTypeClass: propertyType } = relation;

        const query = this.context.filteredQuery(propertyType, "include", false, model, p.value);
        // if (this.filter) {
            // const events = this.context.eventsFor(propertyType, false);
            // if (events) {
            //     query = events.includeFilter(query, model, p.value) ?? query;
            // }
        // }
        const select = cloner.clone((query as EntityQuery).selectStatement);

        // let where: Expression;
        // let joinWhere: Expression;

        const fk = relation.fkColumn ?? relation.relatedRelation.fkColumn;


        if(relation.isInverseRelation) {

            const keyColumn = model.keys[0].columnName;
            let columnName = fk.columnName;
            // for inverse relation, we need to
            // use primary key of current model
            if (!relation.isCollection) {
                columnName = select.model.keys[0].columnName;
            }


            const joins = (select.joins ??= []);
            const joinParameter = Expression.parameter(parent.sourceParameter.name);

            // This join has to be INNER JOIN as we are only interested
            // in the results that matches parent query exactly

            joins.push(JoinExpression.create({
                joinType: "INNER",
                source: { ... parent, fields: [ Expression.member(parent.sourceParameter, keyColumn) ] },
                as: joinParameter,
                model,
                where: Expression.equal(
                    Expression.member(
                        joinParameter,
                        Expression.identifier(keyColumn)
                    ),
                    Expression.member(
                        select.sourceParameter,
                        Expression.identifier(columnName)
                    )
                )
            }));

            // if (parent.where) {
            //     select.where = select.where
            //         ? Expression.logicalAnd(select.where, parent.where)
            //         : parent.where;
            // }

            // if (parent.joins?.length) {
            //      joins.push(... parent.joins);
            // }
            // Object.setPrototypeOf(select, SelectStatement.prototype);
            // const text = DebugStringVisitor.expressionToString(select);
            // console.log(text);
            this.include.push(select);
            return [select, relation.relatedEntity];
        }

        // if we can skip this if join already exists !!

        // joinWhere = Expression.equal(
        //     Expression.member(
        //         parent.sourceParameter,
        //         Expression.identifier(fk.columnName)
        //     ),
        //     Expression.member(
        //         select.sourceParameter,
        //         Expression.identifier(relation.relatedEntity.keys[0].columnName)
        //     )
        // );

        // parent = cloner.clone({ ... parent, fields: [ NumberLiteral.one ]});

        // parent.where = parent.where
        //     ? Expression.logicalAnd(parent.where, joinWhere)
        //     : joinWhere;

        // const existsWhere = ExistsExpression.create({
        //     target: parent
        // });

        // select.where = select.where
        //     ? Expression.logicalAnd(select.where, existsWhere)
        //     : existsWhere;

        const selectJoins = (select.joins ??= []);
        const selectJoinParameter = Expression.parameter(parent.sourceParameter.name);

        // This join has to be INNER JOIN as we are only interested
        // in the results that matches parent query exactly

        selectJoins.push(JoinExpression.create({
            joinType: "INNER",
            source: { ... parent, fields: [ Expression.member(parent.sourceParameter, fk.columnName) ] },
            as: selectJoinParameter,
            model: parent.model,
            // model,
            where: Expression.equal(
                Expression.member(
                    selectJoinParameter,
                    Expression.identifier(fk.columnName)
                ),
                Expression.member(
                    select.sourceParameter,
                    Expression.identifier(relation.relatedEntity.keys[0].columnName)
                )
            )
        }));

        this.include.push(select);

        return [select, relation.relatedEntity];
    }
}

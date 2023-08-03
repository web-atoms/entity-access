import type EntityContext from "./EntityContext.js";
import { IClassOf } from "../decorators/IClassOf.js";
import SchemaRegistry from "../decorators/SchemaRegistry.js";
import { EntitySource } from "./EntitySource.js";
import { BaseDriver } from "../drivers/base/BaseDriver.js";
import EntityType from "../entity-query/EntityType.js";
import { IStringTransformer } from "../query/ast/IStringTransformer.js";

const driverModelCache = Symbol("driverModelCache");

const getOrCreateModel = (map: Map<any, EntityType>, type: IClassOf<any>, namingConvention: IStringTransformer) => {
    let t = map.get(type);
    if (t) {
        return t;
    }
    const original = SchemaRegistry.model(type);
    t = new EntityType(original);
    map.set(type,  t);
    for (const iterator of original.columns) {
        const column = { ... iterator };
        column.columnName = column.explicitName ? column.columnName : (namingConvention ? namingConvention(column.columnName) : column.columnName);
        t.addColumn(column);
        column.entityType = t;
    }
    for (const iterator of original.relations) {
        if (iterator.isInverseRelation) {
            continue;
        }
        const relation = { ... iterator};
        t.addRelation(relation, (tc) => getOrCreateModel(map, tc, namingConvention));
    }
    return t;
};

export default class EntityModel {

    public entities: Map<IClassOf<any>, EntitySource> = new Map();

    constructor(private context: EntityContext) {
    }

    register<T>(type: IClassOf<T>) {
        let source = this.entities.get(type);
        if (!source) {
            const cache = (this.context.driver[driverModelCache] ??= new Map());
            const model = getOrCreateModel(cache, type, this.context.driver.compiler.namingConvention);
            source = new EntitySource(model, this.context);
            this.entities.set(type, source);
        }
        return source as EntitySource<T>;
    }

}

import type QueryCompiler from "../compiler/QueryCompiler.js";
import { IIndex } from "../decorators/IIndex.js";
import SchemaRegistry from "../decorators/SchemaRegistry.js";
import type EntityType from "../entity-query/EntityType.js";
import type EntityContext from "../model/EntityContext.js";

export default abstract class Migrations {

    constructor(protected compiler: QueryCompiler) {}

    public async migrate(context: EntityContext) {
        for (const iterator of context.model.entities.keys()) {
            const type = SchemaRegistry.model(iterator);
            await this.migrateTable(context, type);

            for (const index of type.indexes) {
                await this.migrateIndexInternal(context, index, type);
            }
        }

    }

    async migrateIndexInternal(context: EntityContext, index: IIndex, type: EntityType) {
        // parse filter... pending...
        this.migrateIndex(context, index, type);

    }

    abstract migrateIndex(context: EntityContext, index: IIndex, type: EntityType);

    abstract migrateTable(context: EntityContext, type: EntityType): Promise<any>;


}

import { IClassOf } from "../../decorators/IClassOf.js";
import { ServiceProvider } from "../../di/di.js";
import { NotSupportedError } from "../../query/parser/NotSupportedError.js";
import type EntityContext from "../EntityContext.js";
import type EntityEvents from "./EntityEvents.js";

export default class ContextEvents {

    private map: Map<any, IClassOf<EntityEvents<any>>> = new Map();

    public for<T>(type: IClassOf<T>, fail = true): IClassOf<EntityEvents<T>> {
        const typeClass = this.map.get(type);
        if (!typeClass) {
            if (fail) {
                throw new NotSupportedError();
            }
            return null;
        }
        return typeClass;
    }

    public register<T>(type: IClassOf<T>, events: IClassOf<EntityEvents<T>>) {
        this.map.set(type, events);
    }

}
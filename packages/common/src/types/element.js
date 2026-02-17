// import { ShapeType } from "../constants";
// Type guard for shape validation
export function isDriplElement(element) {
    return (element &&
        typeof element.id === "string" &&
        typeof element.type === "string" &&
        typeof element.x === "number" &&
        typeof element.y === "number" &&
        typeof element.width === "number" &&
        typeof element.height === "number");
}
//# sourceMappingURL=element.js.map
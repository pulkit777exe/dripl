export interface User {
    id: string;
    name: string;
    color: string;
}
export interface Presence {
    userId: string;
    cursor: {
        x: number;
        y: number;
    } | null;
    selection: string[];
}
//# sourceMappingURL=user.d.ts.map
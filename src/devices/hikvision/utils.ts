export function parseDimension(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseBoolean(value: unknown): boolean | undefined {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        if (value === 1) {
            return true;
        }

        if (value === 0) {
            return false;
        }
    }

    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();

        if (normalized === 'true' || normalized === '1') {
            return true;
        }

        if (normalized === 'false' || normalized === '0') {
            return false;
        }
    }

    return undefined;
}

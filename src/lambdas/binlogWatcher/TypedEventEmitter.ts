export interface TypedEventEmitter<T> {
    addListener<K extends keyof T>(s: K, listener: (v: T[K]) => void);

    emit<K extends keyof T>(s: K, v: T[K]);

    off<K extends keyof T>(s: K, listener: (v: T[K]) => void);

    on<K extends keyof T>(s: K, listener: (v: T[K]) => void);

    once<K extends keyof T>(s: K, listener: (v: T[K]) => void);

    removeListener<K extends keyof T>(s: K, listener: (v: T[K]) => void);
}

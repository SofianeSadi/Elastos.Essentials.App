export class Logger {
    private static originalConsole = null;
    private static originalDebugLog: (...args)=>void;
    private static originalDebugWarn: (...args)=>void;
    private static originalDebugErr: (...args)=>void;

    public static init(originalConsole: Console) {
        this.originalConsole = originalConsole;

        // Replace original log methods with placeholders to warn that the migration is needed
        this.originalDebugLog = this.originalConsole.log;
        this.originalDebugWarn = this.originalConsole.warn;
        this.originalDebugErr = this.originalConsole.error;

        this.originalConsole.log = (...args) => {
            this.originalDebugLog.apply(this.originalConsole, ["%cConvert-To-Logger", 'background: #d59100; color: #FFF; font-weight:bold; padding:5px;', ...args]);
        }
        this.originalConsole.warn = (...args) => {
            this.originalDebugWarn.apply(this.originalConsole, ["%cConvert-To-Logger", 'background: #d59100; color: #FFF; font-weight:bold; padding:5px;', ...args]);
        }
        this.originalConsole.error = (...args) => {
            this.originalDebugErr.apply(this.originalConsole, ["%cConvert-To-Logger", 'background: #d59100; color: #FFF; font-weight:bold; padding:5px;', ...args]);
        }
    }

    public static log(module: string, ...args: any) {
        this.originalDebugLog.apply(this.originalConsole, [
            "%c"+module.toUpperCase()+"*", 'background: #008730; color: #FFF; font-weight:bold; padding:5px;',
            ...args]);
    }

    public static warn(module: string, ...args: any) {
        this.originalDebugWarn.apply(this.originalConsole, [
            "%c"+module.toUpperCase()+"* WARNING", 'background: #d59100; color: #FFF; font-weight:bold; padding:5px;',
            ...args]);
    }

    public static error(module: string, ...args: any) {
        this.originalDebugErr.apply(this.originalConsole, [
            "%c"+module.toUpperCase()+"* ERROR", 'background: #b30202; color: #FFF; font-weight:bold; padding:5px;',
            ...args]);
    }
}
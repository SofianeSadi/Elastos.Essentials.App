export abstract class DIDPublisher {
  public abstract publishDID(didString: string, payloadObject: any, memo: string, showBlockingLoader: boolean, parentIntentId?: number): Promise<void>;
  public abstract resetStatus();
}
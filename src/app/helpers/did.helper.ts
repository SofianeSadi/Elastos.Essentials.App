
import { Logger } from "src/app/logger";
import { PasswordManagerCancelallationException } from "../model/exceptions/passwordmanagercancellationexception";
import { WrongPasswordException } from "../model/exceptions/wrongpasswordexception.exception";

/**
 * Converts a did:elastos:abcdefghijklmn string into did:elastos:abcd...klmn
 */
export const reducedDidString = (didString: string): string => {
  if (!didString)
    return null;

  if (!didString.startsWith("did:elastos:"))
    return didString;

  let shortForm = didString.replace("did:elastos:", "");
  if (shortForm.length < 12)
    return didString;

  return `did:elastos:${shortForm.substr(0, 6)}...${shortForm.substr(shortForm.length - 6, 6)}`;
}

export class DIDHelper {
  /**
   * From a raw JS exception, try to extract more usable information and return clearer
   * exception types such as WrongPasswordException.
   */
  static reworkedPluginException(e: any) {
    if (e) {
      if (e.code) {
        if (e.message) { // If we have code and message fields in the object, we may be a DIDPluginException type
          // TODO: Add error code enum in DID Plugin typings and don't hardcode code values here.
          if (e.code == 10016 || e.message.includes("password") || e.message.includes("WrongPasswordException"))
            return new WrongPasswordException();
        }
      }

      if (e.message) {
        if (e.message.includes("MasterPasswordCancellation")) {
          return new PasswordManagerCancelallationException();
        }

        if (e.message.includes("Authentication error [10]")) {
          return new PasswordManagerCancelallationException();
        }
      }
    }

    Logger.log("Identity", "No specific exception info");
    return e; // No more info - return the raw error.
  }

  static reworkedApiNoAuthorityException(e) {
    if (!e || typeof (e) !== "string") {
      Logger.log("Identity", "No specific exception info");
      return e; // No more info - return the raw error.
    }

    // if (e.includes("have not run authority"))
    //   return new ApiNoAuthorityException(e);

    // All other cases: return the raw error.
    return e;
  }
}

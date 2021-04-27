import { Injectable, NgZone } from '@angular/core';
import { Subject } from 'rxjs';
import { Logger } from '../logger';
import WalletConnect from "@walletconnect/client";
import { GlobalNavService } from './global.nav.service';
import { GlobalPreferencesService } from './global.preferences.service';
import { GlobalDIDSessionsService } from './global.didsessions.service';
import { NetworkType } from '../model/networktype';
import { JsonRpcRequest, SessionRequestParams, WalletConnectSession } from '../model/walletconnect/types';
import { GlobalIntentService } from './global.intent.service';
import { GlobalStorageService } from './global.storage.service';
import { GlobalNativeService } from './global.native.service';

declare let essentialsIntentManager: EssentialsIntentPlugin.IntentManager;

@Injectable({
  providedIn: 'root'
})
export class GlobalWalletConnectService {
  private connectors: Map<string, WalletConnect> = new Map(); // List of initialized WalletConnect instances.

  constructor(
    private zone: NgZone,
    private nav: GlobalNavService,
    private storage: GlobalStorageService,
    private prefs: GlobalPreferencesService,
    private intent: GlobalIntentService,
    private didSessions: GlobalDIDSessionsService,
    private intents: GlobalIntentService,
    private native: GlobalNativeService
  ) {}

  init() {
    this.didSessions.signedInIdentityListener.subscribe(async (signedInIdentity)=>{
      if (signedInIdentity) {
        // Re-activate existing sessions to reconnect to their wallet connect bridges.
        this.restoreSessions();
      }
    });

    this.intents.intentListener.subscribe((receivedIntent)=>{
      if (!receivedIntent)
        return;

      if (receivedIntent.action === "rawurl") {
        if (receivedIntent.params && receivedIntent.params.url) {
          // Make sure this raw url coming from outside is for us
          let rawUrl: string = receivedIntent.params.url;
          if (this.canHandleUri(rawUrl)) {
            this.zone.run(()=>{
              this.handleWCURIRequest(rawUrl);
            });
          }
        }
      }
    });
  }

  /* public async init(): Promise<void> {
    Logger.log("Intents", "Global intent service is initializing");
  } */

  public canHandleUri(uri: string): boolean {
    if (!uri || !uri.startsWith("wc:")) {
      //Logger.log("walletconnect", "DEBUG CANNOT HANDLE URI", uri);
      return false;
    }

    // We should ignore urls even if starting with "wc:", if they don't contain params, according to wallet connect documentation
    // https://docs.walletconnect.org/mobile-linking
    if (uri.indexOf("?") < 0)
      return false;

    return true;
  }

  /**
   * Handles a scanned or received wc:// url in order to initiate a session with a wallet connect proxy
   * server and client.
   */
  public async handleWCURIRequest(uri: string) {
    if (!this.canHandleUri(uri))
      throw new Error("Invalid WalletConnect URL: "+uri);

    Logger.log("walletconnect", "Handling uri request", uri);

    // While we are waiting to receive the "session_request" command, which could possibly take
    // between a few ms and a few seconds depending on the network, we want to show a temporary screen
    // to let the user wait.
    // TODO: PROBABLY REPLACE THIS WITH A CANCELLABLE DIALOG, FULL SCREEN IS UGLY
    await this.nav.navigateTo("walletconnectsession", "/settings/walletconnect/preparetoconnect", {});

    // Create connector
    let connector = new WalletConnect(
      {
        uri: uri,
        clientMeta: {
          description: "Elastos Essentials",
          url: "https://test.org",
          icons: ["https://test.org/walletconnect-logo.png"],
          name: "WalletConnectTest",
        },
      },
      /* {
        // Optional
        url: "<YOUR_PUSH_SERVER_URL>",
        type: "fcm",
        token: token,
        peerMeta: true,
        language: language,
      } */
    );

    // TODO: wallet connect automatically reuses the persisted session from storage, if one waas
    // established earlier. for debug purpose, we just always disconnect before reconnecting.
    /* if (this.connector.connected) {
      Logger.log("walletconnect", "DEBUG - Already connected, KILLING the session");
      await this.connector.killSession();
      Logger.log("walletconnect", "DEBUG - KILLED");
      Logger.log("walletconnect", "DEBUG - Reconnecting");
      await this.connector.connect();
      Logger.log("walletconnect", "DEBUG - Reconnected");
    } */

    Logger.log("walletconnect", "CONNECTOR", connector);

    this.prepareConnectorForEvents(connector);
  }

  private prepareConnectorForEvents(connector: WalletConnect) {
    this.connectors.set(connector.key, connector);

    // Subscribe to session requests events, when a client app wants to link with our wallet.
    connector.on("session_request", (error, payload) => {
      Logger.log("walletconnect", "Receiving session request", error, payload);

      if (error) {
        throw error;
      }

      this.handleSessionRequest(connector, payload.params[0]);
    });

    // Subscribe to call requests
    connector.on("call_request", (error, payload) => {
      Logger.log("walletconnect", "Receiving call request", error, payload);

      if (error) {
        throw error;
      }

      this.handleCallRequest(connector, payload);
    });

    connector.on("disconnect", (error, payload) => {
      Logger.log("walletconnect", "Receiving disconnection request", error, payload);

      if (error) {
        throw error;
      }

      this.connectors.delete(connector.key);
      this.deleteSession(connector.session);
    });
  }

  /* payload sample:
  {
    "id": 1619053503716825,
    "jsonrpc": "2.0",
    "method": "session_request",
    "params": [
        {
            "peerId": "e810403d-f52e-49ab-8e19-d00c01cb22c9",
            "peerMeta": {
                "description": "",
                "url": "https://example.walletconnect.org",
                "icons": [
                    "https://example.walletconnect.org/favicon.ico"
                ],
                "name": "WalletConnect Example"
            },
            "chainId": null
        }
    ]
  }
  */
  private handleSessionRequest(connector: WalletConnect, request: SessionRequestParams) {
      // User UI prompt
      this.nav.navigateTo("walletconnectsession", "/settings/walletconnect/connect", {
        //connectorKey: connector.key,
        queryParams: {
          connectorKey: connector.key,
          request
        }
      });
  }

  /* payload:
  {
    id: 1,
    jsonrpc: '2.0'.
    method: 'eth_sign',
    params: [
      "0xbc28ea04101f03ea7a94c1379bc3ab32e65e62d3",
      "My email is john@doe.com - 1537836206101"
    ]
  }
  */
  private async handleCallRequest(connector: WalletConnect, request: JsonRpcRequest) {
    if (request.method === "essentials_url_intent") {
      // Custom essentials request (not ethereum) over wallet connect protocol
      await this.handleEssentialsCustomRequest(connector, request);
    }
    else {
      try {
        Logger.log("walletconnect", "Sending esctransaction intent", request);
        let response: {
          action: string,
          result: {
              txid: string,
              status: "published" | "cancelled"
          }
        } = await this.intent.sendIntent("https://wallet.elastos.net/esctransaction", {
          payload: request
        });
        Logger.log("walletconnect", "Got esctransaction intent response", response);

        if (response && response.result.status === "published") {
          // Approve Call Request
          connector.approveRequest({
            id: request.id,
            result: "0x41791102999c339c844880b23950704cc43aa840f3739e365323cda4dfa89e7a"
          });
        }
        else {
          // Approve Call Request
          connector.rejectRequest({
            id: request.id,
            error: {
              code: 12345,
              message: "Errored or cancelled - TODO: improve this error handler"
            }
          });
        }
      }
      catch (e) {
        Logger.error("walletconnect", "Send intent error", e);
        // Reject Call Request
        connector.rejectRequest({
          id: request.id,
          error: {
            code: 12345,
            message: e
          }
        });
      }
    }

    // Because for now we don't close Essentials after handling wallet connect requests, we simply
    // inform users to manually "alt tab" to return to the app they are coming from.
    this.native.genericToast("Operation completed, please return to the original app.", 4000);
  }

  /**
   * Handles custom essentials request coming from the wallet connect protocol.
   * method: "essentials_url_intent"
   * params: {url: "the essentials intent url" }
   */
  private async handleEssentialsCustomRequest(connector: WalletConnect, request: JsonRpcRequest) {
    let intentUrl = request.params[0]["url"] as string;
    try {
      Logger.log("walletconnect", "Sending custom essentials intent request", intentUrl);
      let response = await this.intent.sendUrlIntent(intentUrl);
      Logger.log("walletconnect", "Got custom request intent response", response);

      // Approve Call Request
      connector.approveRequest({
        id: request.id,
        result: response
      });
    }
    catch (e) {
      Logger.error("walletconnect", "Send intent error", e);
      // Reject Call Request
      connector.rejectRequest({
        id: request.id,
        error: {
          code: 12345,
          message: e
        }
      });

      // Let the user know that the request was received but could not be handled
      this.native.genericToast("An external application just tried to send a request that cannot be understood by Elastos Essentials.", 2000);

      if (await this.prefs.developerModeEnabled(GlobalDIDSessionsService.signedInDIDString))
        this.native.genericToast("Raw request: "+intentUrl, 2000);
    }
  }

  public async acceptSessionRequest(connectorKey: string, ethAccountAddresses: string[]) {
    let activeNetwork = await this.prefs.getActiveNetworkType(GlobalDIDSessionsService.signedInDIDString);
    let chainId: number;

    switch (activeNetwork) {
      case NetworkType.MainNet:
        chainId = 20; break;
      case NetworkType.TestNet:
        chainId = 21; break;
      default:
        throw new Error("Network currently selected in settings is not supported with wallet connect yet (unknown chain id). To be improved.");
    }

    Logger.log("walletconnect", "Accepting session request with params:", connectorKey, ethAccountAddresses, chainId);

    let connector = this.findConnectorFromKey(connectorKey);

    // Approve Session
    await connector.approveSession({
      accounts: ethAccountAddresses,
      chainId: chainId
    });

    await this.saveSession(connector.session);
  }

  public rejectSession() {
    // Reject Session
    /* TODO connector.rejectSession({
      message: 'OPTIONAL_ERROR_MESSAGE'       // optional
    }) */
  }

  public async killSession(connector: WalletConnect) {
    await connector.killSession();
  }

  public getActiveSessions(): WalletConnect[] {
    return Array.from(this.connectors.values());
  }

  private async restoreSessions() {
    let sessions = await this.loadSessions();

    Logger.log("walletconnect", "Restoring "+sessions.length+" sessions from persistent storage", sessions);
    for (let session of sessions) {
      let connector = new WalletConnect({
        session: session
      });
      this.prepareConnectorForEvents(connector);
    }
    Logger.log("walletconnect", "Restored connectors:", this.connectors);

    // We are directly ready to receive requests after that, without any user intervention.
  }

  private findConnectorFromKey(connectorKey: string): WalletConnect {
    return this.connectors.get(connectorKey);
  }

  private async loadSessions(): Promise<WalletConnectSession[]> {
    let sessions = await this.storage.getSetting<WalletConnectSession[]>(GlobalDIDSessionsService.signedInDIDString, "walletconnect", "sessions", []);
    return sessions;
  }

  private async saveSession(session: WalletConnectSession) {
    let sessions = await this.loadSessions();

    // Replace session if existing, add if new.
    let existingSessionIndex = sessions.findIndex(s=>s.key === session.key);
    if (existingSessionIndex < 0)
      sessions.push(session); // add new
    else
      sessions[existingSessionIndex] = session; // replace

    await this.storage.setSetting(GlobalDIDSessionsService.signedInDIDString, "walletconnect", "sessions", sessions);
  }

  private async deleteSession(session: WalletConnectSession) {
    let sessions = await this.loadSessions();

    let existingSessionIndex = sessions.findIndex(s=>s.key === session.key);
    if (existingSessionIndex >= 0)
      sessions.splice(existingSessionIndex, 1);

    await this.storage.setSetting(GlobalDIDSessionsService.signedInDIDString, "walletconnect", "sessions", sessions);
  }
}
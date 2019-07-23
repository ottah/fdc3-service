import {injectable} from 'inversify';
import {ProviderIdentity} from 'openfin/_v2/api/interappbus/channel/channel';
import {ChannelProvider} from 'openfin/_v2/api/interappbus/channel/provider';
import {Identity} from 'openfin/_v2/main';
import {Signal} from 'openfin-service-signal';

import {SERVICE_CHANNEL, serializeError} from '../client/internal';


/**
 * Semantic type definition.
 *
 * Whilst not enforceable via TypeScript, wherever this type is used it is expected that a string-based enum will be
 * used as the source of that string.
 */
type Enum = string;

/**
 * Defines a tuple that stores the payload and return type of an API method.
 *
 * The first element will be an interface containing the "payload" of the API - an object containing any parameters
 * that need to be passed from client to provider.
 *
 * The second element is the return type of the API - the type (possibly `void`) that is passed from the provider back
 * to the client.
 */
export type APIDefinition = [unknown, unknown];

/**
 * Defines the external API of the service. This is a mapping of method identifiers to `APIDefinition` tuples.
 *
 * The keys of this mapping are the string 'topic' values that are used to communicate via the IAB Channel.
 */
export type APISpecification<T extends Enum> = {
    [key in T]: APIDefinition;
};

/**
 * Given an entry from an APISpecification, defines the function signature of a callback that is can be registered to
 * handle that API call.
 */
export type APIAction<T extends APIDefinition> = (payload: T[0], source: ProviderIdentity) => APIActionReturn<T[1]>;

/**
 * Defines an object that contains a callback for each API method.
 *
 * The signature of each method must match the payload and return type defined in the `T` API specification.
 */
export type APIImplementation<T extends Enum, S extends APISpecification<T>> = {
    [K in T]: APIAction<S[K]>;
};

/**
 * Accept both async and non-async actions. Optionally accept the readonly version of the given type
 */
type APIActionReturn<T> = T | Readonly<T> | Promise<T> | Promise<Readonly<T>>;

/**
 * Generic client/provider interaction handler.
 *
 * Type args:
 *   T: Defines API topics. An enum that defines each available function call.
 */
@injectable()
export class APIHandler<T extends Enum> {
    public readonly onConnection = new Signal<[Identity]>();
    public readonly onDisconnection = new Signal<[Identity]>();

    private _providerChannel!: ChannelProvider;

    public get channel(): ChannelProvider {
        return this._providerChannel;
    }

    public isClientConnection(identity: Identity): boolean {
        return this._providerChannel.connections.some((conn: Identity) => {
            return identity.uuid === conn.uuid && identity.name === conn.name;
        });
    }

    public getClientConnections(): Identity[] {
        return this._providerChannel.connections;
    }

    public async registerListeners<S extends APISpecification<T>>(actionHandlerMap: APIImplementation<T, S>): Promise<void> {
        const providerChannel: ChannelProvider = this._providerChannel = await fin.InterApplicationBus.Channel.create(SERVICE_CHANNEL);

        providerChannel.onConnection(this.onConnectionHandler.bind(this));
        providerChannel.onDisconnection(this.onDisconnectionHandler.bind(this));

        for (const action in actionHandlerMap) {
            if (actionHandlerMap.hasOwnProperty(action)) {
                this._providerChannel.register(action, async (payload, source) => {
                    try {
                        // We need the 'await' here, rather than simply returning the result, to collapse both T and Promise<T> to T
                        const result = await actionHandlerMap[action](payload, source);

                        // We trust that ChannelProvider isn't going to modify the return result, so safe to return a readonly type
                        return result;
                    } catch (error) {
                        throw serializeError(error);
                    }
                });
            }
        }
    }

    // TODO?: Remove the need for this any by defining connection payload type?
    // tslint:disable-next-line:no-any
    private onConnectionHandler(app: Identity, payload?: any): void {
        if (payload && payload.version && payload.version.length > 0) {
            console.log(`connection from client: ${app.name}, version: ${payload.version}`);
        } else {
            console.log(`connection from client: ${app.name}, unable to determine version`);
        }

        // The 'onConnection' callback fires *just before* the channel is ready.
        // Delaying the firing of our signal slightly, to ensure client is definitely contactable.
        setImmediate(() => {
            this.onConnection.emit(app);
        });
    }

    private onDisconnectionHandler(app:Identity): void {
        this.onDisconnection.emit(app);
    }
}

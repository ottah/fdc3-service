import {injectable, inject} from 'inversify';

import {Model} from '../model/Model';
import {Inject} from '../common/Injectables';
import {ChannelId, FDC3Error, ChannelError, ChannelChangedEvent, Context} from '../../client/main';
import {DesktopContextChannel, ContextChannel} from '../model/ContextChannel';
import {AppWindow} from '../model/AppWindow';
import {Signal1} from '../common/Signal';
import {EventTransport} from '../../client/internal';

@injectable()
export class ChannelHandler {
    public readonly onChannelChanged: Signal1<EventTransport<ChannelChangedEvent>> = new Signal1<EventTransport<ChannelChangedEvent>>();

    private readonly _model: Model;

    constructor(@inject(Inject.MODEL) model: Model) {
        this._model = model;

        this._model.onWindowAdded.add(this.onModelWindowAdded, this);
        this._model.onWindowRemoved.add(this.onModelWindowRemoved, this);
    }

    public getDesktopChannels(): DesktopContextChannel[] {
        return this._model.channels.filter(channel => channel.type === 'desktop') as DesktopContextChannel[];
    }

    public getWindowsListeningToChannel(channel: ContextChannel): AppWindow[] {
        return this._model.windows.filter(window => window.hasContextListener(channel.id));
    }

    public getChannelById(channelId: ChannelId): ContextChannel {
        this.validateChannelId(channelId);
        return this._model.getChannel(channelId)!;
    }

    public getChannelMembers(channel: ContextChannel): AppWindow[] {
        return this._model.windows.filter(window => window.channel === channel);
    }

    public getChannelContext(channel: ContextChannel): Context | null {
        return channel.getStoredContext();
    }

    public joinChannel(appWindow: AppWindow, channel: ContextChannel): void {
        const previousChannel = appWindow.channel;

        if (previousChannel !== channel) {
            appWindow.channel = channel;

            if (this.isChannelEmpty(previousChannel)) {
                previousChannel.clearStoredContext();
            }

            this.onChannelChanged.emit({type: 'channel-changed', identity: appWindow.identity, channel, previousChannel});
        }
    }

    public setLastBroadcastOnChannel(channel: ContextChannel, context: Context): void {
        if (this._model.windows.some(window => window.channel === channel)) {
            channel.setLastBroadcastContext(context);
        }
    }

    private onModelWindowAdded(window: AppWindow): void {
        this.onChannelChanged.emit({type: 'channel-changed', identity: window.identity, channel: window.channel, previousChannel: null});
    }

    private onModelWindowRemoved(window: AppWindow): void {
        if (this.isChannelEmpty(window.channel)) {
            window.channel.clearStoredContext();
        }

        this.onChannelChanged.emit({type: 'channel-changed', identity: window.identity, channel: null, previousChannel: window.channel});
    }

    private isChannelEmpty(channel: ContextChannel): boolean {
        return !this._model.windows.some(window => window.channel === channel);
    }

    private validateChannelId(channelId: ChannelId): void {
        const channel = this._model.getChannel(channelId);

        if (!channel) {
            throw new FDC3Error(ChannelError.ChannelDoesNotExist, `No channel with channelId: ${channelId}`);
        }
    }
}
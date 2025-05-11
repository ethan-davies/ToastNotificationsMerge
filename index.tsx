/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { makeRange } from "@components/PluginSettings/components";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import {
    Button,
    ChannelStore,
    GuildStore,
    NavigationRouter,
    RelationshipStore,
    SelectedChannelStore,
    UserStore
} from "@webpack/common";
import { Channel, Message, User } from "discord-types/general";
import { RelationshipType } from "plugins/relationshipNotifier/types";
import { ReactNode } from "react";
import { Webpack } from "Vencord";

import { NotificationData, showNotification } from "./components/Notifications";
import { MessageTypes } from "./types";

let ignoredUsers: string[] = [];
let notifyFor: string[] = [];

const MuteStore = Webpack.findByPropsLazy("isSuppressEveryoneEnabled");
const SelectedChannelActionCreators = findByPropsLazy("selectPrivateChannel");
const UserUtils = findByPropsLazy("getGlobalName");

const USER_MENTION_REGEX = /<@!?(\d{17,20})>|<#(\d{17,20})>|<@&(\d{17,20})>/g;

enum StreamingTreatment {
    NORMAL = 0,
    NO_CONTENT = 1,
    IGNORE = 2
}

function setFadeInDurationCSS(duration: number) {
    document.documentElement.style.setProperty(
        "--toastnotifications-fadein-duration",
        `${duration}ms`
    );
}

function setFinalOpacityCSS(opacity: number) {
    document.documentElement.style.setProperty(
        "--toastnotifications-final-opacity",
        (opacity / 100).toString()
    );
}

export const settings = definePluginSettings({
    position: {
        type: OptionType.SELECT,
        description: "The position of the toast notification",
        options: [
            { label: "Bottom Left", value: "bottom-left", default: true },
            { label: "Top Left", value: "top-left" },
            { label: "Top Right", value: "top-right" },
            { label: "Bottom Right", value: "bottom-right" }
        ]
    },
    timeout: {
        type: OptionType.SLIDER,
        description: "Time in seconds notifications will be shown for",
        default: 5,
        markers: makeRange(1, 15, 1)
    },
    opacity: {
        type: OptionType.SLIDER,
        description: "Opacity of the notification",
        default: 100,
        markers: makeRange(10, 100, 10),
        onChange: (value: number) => setFinalOpacityCSS(value)
    },
    maxNotifications: {
        type: OptionType.SLIDER,
        description: "Maximum number of notifications displayed at once",
        default: 3,
        markers: makeRange(1, 5, 1)
    },
    fadeInDuration: {
        type: OptionType.SLIDER,
        description: "Fade-in duration for notifications (ms)",
        default: 0,
        markers: makeRange(0, 2000, 100),
        onChange: (value: number) => setFadeInDurationCSS(value)
    },
    determineServerNotifications: {
        type: OptionType.BOOLEAN,
        description: "Automatically determine what server notifications to show based on your channel/guild settings",
        default: true
    },
    disableInStreamerMode: {
        type: OptionType.BOOLEAN,
        description: "Disable notifications while in streamer mode",
        default: true
    },
    renderImages: {
        type: OptionType.BOOLEAN,
        description: "Render images in notifications",
        default: true
    },
    directMessages: {
        type: OptionType.BOOLEAN,
        description: "Show notifications for direct messages",
        default: true
    },
    groupMessages: {
        type: OptionType.BOOLEAN,
        description: "Show notifications for group messages",
        default: true
    },
    friendServerNotifications: {
        type: OptionType.BOOLEAN,
        description: "Show notifications when friends send messages in servers they share with you",
        default: true
    },
    friendActivity: {
        type: OptionType.BOOLEAN,
        description: "Show notifications for friend activity",
        default: true
    },
    streamingTreatment: {
        type: OptionType.SELECT,
        description: "How to treat notifications while sharing your screen",
        options: [
            { label: "Normal - Show the notification as normal", value: StreamingTreatment.NORMAL, default: true },
            { label: "No Content - Hide the notification body", value: StreamingTreatment.NO_CONTENT },
            { label: "Ignore - Don't show the notification at all", value: StreamingTreatment.IGNORE }
        ]
    },
    notifyFor: {
        type: OptionType.STRING,
        description: "Create a list of channel ids to receive notifications from (separate with commas)",
        onChange: () => { notifyFor = stringToList(settings.store.notifyFor); },
        default: ""
    },
    ignoreUsers: {
        type: OptionType.STRING,
        description: "Create a list of user ids to ignore all their notifications from (separate with commas)",
        onChange: () => { ignoredUsers = stringToList(settings.store.ignoreUsers); },
        default: ""
    },
    disableMessageBody: {
        type: OptionType.BOOLEAN,
        description: "Redact message body in all notifications",
        default: false
    },
    exampleButton: {
        type: OptionType.COMPONENT,
        description: "Show an example toast notification.",
        component: () =>
            <Button onClick={showExampleNotification}>
                Show Example Notification
            </Button>
    }
});

function stringToList(str: string): string[] {
    return str ? str.replace(/\s/g, "").split(",") : [];
}

function limitMessageLength(body: string, hasAttachments: boolean): string {
    if (hasAttachments && body?.length > 30) return body.substring(0, 27) + "...";
    if (body?.length > 165) return body.substring(0, 162) + "...";
    return body;
}

function getName(user: User): string {
    return RelationshipStore.getNickname(user.id) ?? UserUtils.getName(user);
}

function getAvatarURL(user: User): string {
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
}

function addMention(id: string, type: string, guildId?: string): ReactNode {
    let name;
    if (type === "user")
        name = `@${UserStore.getUser(id)?.username || "unknown-user"}`;
    else if (type === "channel")
        name = `#${ChannelStore.getChannel(id)?.name || "unknown-channel"}`;
    else if (type === "role" && guildId)
        name = `@${GuildStore.getGuild(guildId).getRole(id)?.name || "unknown-role"}`;
    return (
        <span key={`${type}-${id}`} className="toastnotifications-mention-class">
            {name}
        </span>
    );
}

function parseMentions(body: string, channel: Channel): ReactNode[] {
    const elements: ReactNode[] = [];
    let lastIndex = 0;
    body.replace(USER_MENTION_REGEX, (match, userId, channelId, roleId, offset) => {
        elements.push(body.slice(lastIndex, offset));
        if (userId) elements.push(addMention(userId, "user"));
        else if (channelId) elements.push(addMention(channelId, "channel"));
        else if (roleId) elements.push(addMention(roleId, "role", channel.guild_id));
        lastIndex = offset + match.length;
        return match;
    });
    if (lastIndex < body.length) elements.push(body.slice(lastIndex));
    return elements;
}

function formatEmotes(body: string): string {
    return body.replace(/(<a?:\w+:\d+>)/g, match => `:${match.split(":")[1]}:`);
}

function getNotificationTitle(message: Message, channel: Channel): string {
    if (channel.isGroupDM()) {
        let channelName = channel.name?.trim() || channel.rawRecipients?.slice(0, 3).map(e => e.username).join(", ");
        if (channelName?.length > 20) channelName = channelName.substring(0, 20) + "...";
        return `${message.author.username} (${channelName})`;
    }
    if (channel.guild_id) return `${getName(message.author)} (#${channel.name})`;
    return getName(message.author);
}

function getNotificationBody(message: Message, channel: Channel): string {
    switch (message.type) {
        case MessageTypes.CALL:
            return "Started a call with you!";
        case MessageTypes.CHANNEL_RECIPIENT_ADD: {
            const actor = UserStore.getUser(message.author.id);
            const userId = message.mentions[0]?.replace(/[<@!>]/g, "");
            const targetUser = UserStore.getUser(userId);
            return `${getName(targetUser)} was added to the group by ${getName(actor)}.`;
        }
        case MessageTypes.CHANNEL_RECIPIENT_REMOVE: {
            const actor = UserStore.getUser(message.author.id);
            const userId = message.mentions[0]?.replace(/[<@!>]/g, "");
            const targetUser = UserStore.getUser(userId);
            return actor.id !== targetUser.id
                ? `${getName(targetUser)} was removed from the group by ${getName(actor)}.`
                : "Left the group.";
        }
        case MessageTypes.CHANNEL_NAME_CHANGE:
            return `Changed the channel name to '${message.content}'.`;
        case MessageTypes.CHANNEL_ICON_CHANGE:
            return "Changed the channel icon.";
        case MessageTypes.CHANNEL_PINNED_MESSAGE:
            return "Pinned a message.";
        default:
            if (message.embeds?.length) return message.content || "Sent an embed.";
            if (message.stickerItems) return message.content || "Sent a sticker.";
            if (message.attachments?.length) {
                const images = message.attachments.filter(e => e?.content_type?.startsWith("image"));
                if (images.length) return message.content || "";
                return (message.content || "") + ` [Attachment: ${message.attachments[0].filename}]`;
            }
            return message.content;
    }
}

function buildNotificationData(
    message: Message,
    channel: Channel,
    onClick: () => void
): NotificationData {
    let body = getNotificationBody(message, channel);
    body = formatEmotes(body);

    const richBodyElements =
        (message.mentions?.length || message.mentionRoles?.length)
            ? parseMentions(body, channel)
            : null;

    const notification: NotificationData = {
        title: getNotificationTitle(message, channel),
        icon: getAvatarURL(message.author),
        body: limitMessageLength(body, !!message.attachments?.length),
        attachments: message.attachments?.length,
        richBody: richBodyElements?.length
            ? <>{richBodyElements}</>
            : null,
        permanent: false,
        onClick,
    };

    if (message.attachments?.length) {
        const images = message.attachments.filter(e => e?.content_type?.startsWith("image"));
        if (images.length) notification.image = images[0].url;
    }

    return notification;
}

export default definePlugin({
    name: "ToastNotifications",
    description: "Show a toast notification whenever you receive a direct message.",
    authors: [
        { name: "Ethan", id: 721717126523781240n },
        { name: "Skully", id: 150298098516754432n },
        { name: "Buzzy", id: 1273353654644117585n }
    ],
    settings,
    flux: {
        async MESSAGE_CREATE({ message }: { message: Message; }) {
            const channel = ChannelStore.getChannel(message.channel_id);
            const currentUser = UserStore.getCurrentUser();

            const isStreaming =
                Vencord.Webpack.findStore("ApplicationStreamingStore")
                    .getState().activeStreams?.length >= 1;
            const streamerMode = settings.store.disableInStreamerMode;
            const currentUserStreamerMode =
                Vencord.Webpack.findStore("StreamerModeStore").enabled;

            if (
                streamerMode && currentUserStreamerMode ||
                isStreaming && settings.store.streamingTreatment === StreamingTreatment.IGNORE ||
                message.author.id === currentUser.id ||
                channel.id === SelectedChannelStore.getChannelId() ||
                ignoredUsers.includes(message.author.id)
            ) return;

            if (channel.guild_id) {
                await handleGuildMessage(message);
                return;
            }

            if (
                (!settings.store.directMessages && channel.isDM()) ||
                (!settings.store.groupMessages && channel.isGroupDM()) ||
                MuteStore.isChannelMuted(null, channel.id)
            ) return;

            const notification = buildNotificationData(
                message,
                channel,
                () => SelectedChannelActionCreators.selectPrivateChannel(message.channel_id)
            );

            if (
                (isStreaming && settings.store.streamingTreatment === StreamingTreatment.NO_CONTENT) ||
                settings.store.disableMessageBody
            ) {
                notification.body = "Message content has been redacted.";
                notification.richBody = null;
            }

            showNotification(notification);
        },

        async RELATIONSHIP_ADD({ relationship }) {
            if (ignoredUsers.includes(relationship.user.id)) return;
            relationshipAdd(relationship.user, relationship.type);
        }
    },

    start() {
        ignoredUsers = stringToList(settings.store.ignoreUsers);
        notifyFor = stringToList(settings.store.notifyFor);
        setFadeInDurationCSS(settings.store.fadeInDuration);
        setFinalOpacityCSS(settings.store.opacity);
    }
});

enum NotificationLevel {
    ALL_MESSAGES = 0,
    ONLY_MENTIONS = 1,
    NO_MESSAGES = 2
}

function findNotificationLevel(channel: Channel): NotificationLevel {
    const store = Vencord.Webpack.findStore("UserGuildSettingsStore");
    const userGuildSettings = store.getAllSettings().userGuildSettings[channel.guild_id];

    if (
        !settings.store.determineServerNotifications ||
        MuteStore.isGuildOrCategoryOrChannelMuted(channel.guild_id, channel.id)
    ) return NotificationLevel.NO_MESSAGES;

    if (userGuildSettings) {
        const channelOverrides = userGuildSettings.channel_overrides?.[channel.id];
        const guildDefault = userGuildSettings.message_notifications;
        if (channelOverrides && typeof channelOverrides === "object" && "message_notifications" in channelOverrides)
            return channelOverrides.message_notifications;
        if (typeof guildDefault === "number") return guildDefault;
    }
    return NotificationLevel.NO_MESSAGES;
}

async function handleGuildMessage(message: Message) {
    const channel = ChannelStore.getChannel(message.channel_id);
    const notificationLevel = findNotificationLevel(channel);

    const all = notifyFor.includes(message.channel_id);
    const friend =
        settings.store.friendServerNotifications &&
        RelationshipStore.isFriend(message.author.id);

    if (!all && !friend) {
        const isMention = message.content.includes(`<@${UserStore.getCurrentUser().id}>`);
        const meetsMentionCriteria =
            notificationLevel !== NotificationLevel.ALL_MESSAGES && !isMention;
        if (
            notificationLevel === NotificationLevel.NO_MESSAGES ||
            meetsMentionCriteria
        ) return;
    }

    const notification = buildNotificationData(
        message,
        channel,
        () => switchChannels(channel.guild_id, channel.id)
    );

    const isStreaming =
        Vencord.Webpack.findStore("ApplicationStreamingStore")
            .getState().activeStreams?.length >= 1;

    if (
        (isStreaming && settings.store.streamingTreatment === StreamingTreatment.NO_CONTENT) ||
        settings.store.disableMessageBody
    ) {
        notification.body = "Message content has been redacted.";
        notification.richBody = null;
    }

    await showNotification(notification);
}

async function relationshipAdd(user: User, type: Number) {
    if (!settings.store.friendActivity) return;
    user = UserStore.getUser(user.id);

    const notification: NotificationData = {
        title: "",
        icon: getAvatarURL(user),
        body: "",
        attachments: 0,
    };

    if (type === RelationshipType.FRIEND) {
        notification.title = `${user.username} is now your friend`;
        notification.body = "You can now message them directly.";
        notification.onClick = () => switchChannels(null, user.id);
    } else if (type === RelationshipType.INCOMING_REQUEST) {
        notification.title = `${user.username} sent you a friend request`;
        notification.body = "You can accept or decline it in the Friends tab.";
        notification.onClick = () => switchChannels(null, "");
    } else {
        return;
    }

    await showNotification(notification);
}

function switchChannels(guildId: string | null, channelId: string) {
    if (!ChannelStore.hasChannel(channelId)) return;
    NavigationRouter.transitionTo(`/channels/${guildId ?? "@me"}/${channelId}/`);
}

function showExampleNotification(): Promise<void> {
    const user = UserStore.getCurrentUser();
    return showNotification({
        title: "Example Notification",
        icon: getAvatarURL(user),
        body: "This is an example toast notification!",
        attachments: 0,
        permanent: false
    });
}

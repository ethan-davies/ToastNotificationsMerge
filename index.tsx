/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { definePluginSettings } from "@api/Settings";
import { makeRange } from "@components/PluginSettings/components";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Button, ChannelStore, GuildStore, NavigationRouter, RelationshipStore, SelectedChannelStore, UserStore } from "@webpack/common";
import type { Channel, Message, MessageAttachment, User } from "discord-types/general";
import { ReactNode } from "react";
import { Webpack } from "Vencord";

import { NotificationData, showNotification } from "./components/Notifications";
import { MessageTypes } from "./types";
import { RelationshipType } from "plugins/relationshipNotifier/types";

let ignoredUsers: string[] = [];
let notifyFor: string[] = [];

// Functional variables.
const MuteStore = Webpack.findByPropsLazy("isSuppressEveryoneEnabled");
const SelectedChannelActionCreators = findByPropsLazy("selectPrivateChannel");
const UserUtils = findByPropsLazy("getGlobalName");

// Adjustable variables.
const USER_MENTION_REGEX = /<@!?(\d{17,20})>|<#(\d{17,20})>|<@&(\d{17,20})>/g; // This regex captures user, channel, and role mentions.

export const settings = definePluginSettings({
    position: {
        type: OptionType.SELECT,
        description: "The position of the toast notification",
        options: [
            {
                label: "Bottom Left",
                value: "bottom-left",
                default: true
            },
            {
                label: "Top Left",
                value: "top-left"
            },
            {
                label: "Top Right",
                value: "top-right"
            },
            {
                label: "Bottom Right",
                value: "bottom-right"
            },
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
        markers: makeRange(10, 100, 10)
    },
    maxNotifications: {
        type: OptionType.SLIDER,
        description: "Maximum number of notifications displayed at once",
        default: 3,
        markers: makeRange(1, 5, 1)
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
    if (str !== "") {
        const array: string[] = [];
        const string = str.replace(/\s/g, '');
        const splitArray = string.split(",");
        splitArray.forEach((id) => {
            array.push(id);
        });

        return array;
    }
    return [];
}

function limitMessageLength(body: string, hasAttachments: boolean): string {
    if (hasAttachments) {
        if (body.length > 30) {
            return body.substring(0, 27) + "...";
        }
    }

    if (body.length > 165) {
        return body.substring(0, 162) + "...";
    }

    return body;
}

/**
 * getName()
 * Helper function to get a user's nickname if they have one, otherwise their username.
 *
 * @param   {User}      user    The user to get the name of.
 * @returns {String}            The name of the user.
 */
function getName(user: User): string {
    return RelationshipStore.getNickname(user.id) ?? UserUtils.getName(user);
}

/**
 * addMention()
 * Helper function to add a mention to a notification.
 *
 * @param   {string}    id          The id of the user, channel or role.
 * @param   {string}    type        The type of mention.
 * @param   {string}    guildId     The id of the guild.
 * @returns {ReactNode}             The mention as a ReactNode.
 */
const addMention = (id: string, type: string, guildId?: string): ReactNode => {
    let name;
    if (type === "user")
        name = `@${UserStore.getUser(id)?.username || "unknown-user"}`;
    else if (type === "channel")
        name = `#${ChannelStore.getChannel(id)?.name || "unknown-channel"}`;
    else if (type === "role" && guildId)
        name = `@${GuildStore.getGuild(guildId).getRole(id)?.name || "unknown-role"}`;

    // Return the mention as a styled span.
    return (
        <span key={`${type}-${id}`} className={"toastnotifications-mention-class"}>
            {name}
        </span>
    );
};

export default definePlugin({
    name: "ToastNotifications",
    description: "Show a toast notification whenever you receive a direct message.",
    authors: [
        {
            name: "Skully",
            id: 150298098516754432n
        },
        {
            name: "Ethan",
            id: 721717126523781240n
        }
    ],
    settings,
    flux: {
        async MESSAGE_CREATE({ message }: { message: Message; }) {
            const channel: Channel = ChannelStore.getChannel(message.channel_id);
            const currentUser = UserStore.getCurrentUser();

            const streamerMode = settings.store.disableInStreamerMode;
            const currentUserStreamerMode = Vencord.Webpack.findStore("StreamerModeStore").enabled;

            if (streamerMode && currentUserStreamerMode) return;

            if (channel.guild_id) { // If this is a guild message and not a private message.
                if (!ignoredUsers.includes(message.author.id)) {
                    handleGuildMessage(message);
                }
                return;
            }
            // Determine whether or not to show notifications.
            if (
                (
                    (message.author.id === currentUser.id) // If message is from the user.
                    || (!MuteStore.allowAllMessages(channel)) // If user has muted the channel.
                    || (channel.id === SelectedChannelStore.getChannelId()) // If the user is currently in the channel.
                    || (ignoredUsers.includes(message.author.id)) // If the user is ignored.
                    || (!settings.store.directMessages && channel.isDM()) // If the user has disabled DM notifications.
                    || (!settings.store.groupMessages && channel.isGroupDM()) // If the user has disabled group DM notifications.
                )
            ) return;


            // Prepare the notification.
            const Notification: NotificationData = {
                title: getName(message.author),
                icon: `https://cdn.discordapp.com/avatars/${message.author.id}/${message.author.avatar}.png?size=128`,
                body: message.content,
                attachments: message.attachments.length,
                richBody: null,
                permanent: false,
                onClick() { SelectedChannelActionCreators.selectPrivateChannel(message.channel_id); }
            };

            const notificationText = message.content.length > 0 ? message.content : false;
            const richBodyElements: React.ReactNode[] = [];

            // If this channel is a group DM, include the channel name.
            if (channel.isGroupDM()) {
                let channelName = channel.name?.trim() ?? false;
                if (!channelName) { // If the channel doesn't have a set name, use the first 3 recipients.
                    channelName = channel.rawRecipients.slice(0, 3).map(e => e.username).join(", ");
                }

                // Finally, truncate the channel name if it's too long.
                const truncatedChannelName = channelName.length > 20 ? channelName.substring(0, 20) + "..." : channelName;
                Notification.title = `${message.author.username} (${truncatedChannelName})`;
            }
            else if (channel.guild_id) // If this is a guild message and not a private message.
            {
                Notification.title = `${getName(message.author)} (#${channel.name})`;
            }

            // Handle specific message types.
            switch (message.type) {
                case MessageTypes.CALL: {
                    Notification.body = "Started a call with you!";
                    break;
                }
                case MessageTypes.CHANNEL_RECIPIENT_ADD: {
                    const actor = UserStore.getUser(message.author.id);
                    const targetUser = UserStore.getUser(message.mentions[0]?.id);

                    Notification.body = `${getName(targetUser)} was added to the group by ${getName(actor)}.`;
                    break;
                }
                case MessageTypes.CHANNEL_RECIPIENT_REMOVE: {
                    const actor = UserStore.getUser(message.author.id);
                    const targetUser = UserStore.getUser(message.mentions[0]?.id);

                    if (actor.id !== targetUser.id) {
                        Notification.body = `${getName(targetUser)} was removed from the group by ${getName(actor)}.`;
                    } else {
                        Notification.body = "Left the group.";
                    }
                    break;
                }
                case MessageTypes.CHANNEL_NAME_CHANGE: {
                    Notification.body = `Changed the channel name to '${message.content}'.`;
                    break;
                }
                case MessageTypes.CHANNEL_ICON_CHANGE: {
                    Notification.body = "Changed the channel icon.";
                    break;
                }
                case MessageTypes.CHANNEL_PINNED_MESSAGE: {
                    Notification.body = "Pinned a message.";
                    break;
                }
            }

            // Message contains an embed.
            if (message.embeds.length !== 0) {
                Notification.body = notificationText || "Sent an embed.";
            }

            // Message contains a sticker.
            if (message?.stickerItems) {
                Notification.body = notificationText || "Sent a sticker.";
            }

            // Message contains an attachment.
            if (message.attachments.length !== 0) {
                const images = message.attachments.filter(e => typeof e?.content_type === "string" && e?.content_type.startsWith("image"));
                // Label the notification with the attachment type.
                if (images.length !== 0) {
                    Notification.body = notificationText || ""; // Dont show any body
                    Notification.image = images[0].url;
                } else {
                    Notification.body += ` [Attachment: ${message.attachments[0].filename}]`;
                }
            }

            // TODO: Format emotes properly.
            const matches = Notification.body.match(new RegExp("(<a?:\\w+:\\d+>)", "g"));
            if (matches) {
                for (const match of matches) {
                    Notification.body = Notification.body.replace(new RegExp(`${match}`, "g"), `:${match.split(":")[1]}:`);
                }
            }

            // Replace any mention of users, roles and channels.
            if (message.mentions.length !== 0 || message.mentionRoles?.length > 0) {
                let lastIndex = 0;
                Notification.body.replace(USER_MENTION_REGEX, (match, userId, channelId, roleId, offset) => {
                    richBodyElements.push(Notification.body.slice(lastIndex, offset));

                    // Add the mention itself as a styled span.
                    if (userId) {
                        richBodyElements.push(addMention(userId, "user"));
                    } else if (channelId) {
                        richBodyElements.push(addMention(channelId, "channel"));
                    } else if (roleId) {
                        richBodyElements.push(addMention(roleId, "role", channel.guild_id));
                    }

                    lastIndex = offset + match.length;
                    return match; // This value is not used but is necessary for the replace function
                });
            }

            if (richBodyElements.length > 0) {
                const MyRichBodyComponent = () => <>{richBodyElements}</>;
                Notification.richBody = <MyRichBodyComponent />;
            }

            Notification.body = limitMessageLength(Notification.body, Notification.attachments > 0);
            showNotification(Notification);
        },

        async RELATIONSHIP_ADD({ relationship }) {
            if (ignoredUsers.includes(relationship.user.id)) return;
            relationshipAdd(relationship.user, relationship.type);
        }
    },

    start() {
        ignoredUsers = stringToList(settings.store.ignoreUsers);
        notifyFor = stringToList(settings.store.notifyFor);
    }
});

function switchChannels(guildId: string | null, channelId: string) {
    if (!ChannelStore.hasChannel(channelId)) return;
    NavigationRouter.transitionTo(`/channels/${guildId ?? "@me"}/${channelId}/`);
}

async function handleGuildMessage(message: Message) {
    // todo: check if the user who sent it is a friend
    const all = notifyFor.includes(message.channel_id);
    const friend = settings.store.friendServerNotifications && RelationshipStore.isFriend(message.author.id);

    if (!(all || friend))
        return;

    const channel: Channel = ChannelStore.getChannel(message.channel_id);

    const notificationText = message.content.length > 0 ? message.content : false;
    const richBodyElements: React.ReactNode[] = [];

    // Prepare the notification.
    const Notification: NotificationData = {
        title: `${getName(message.author)} (#${channel.name})`,
        icon: `https://cdn.discordapp.com/avatars/${message.author.id}/${message.author.avatar}.png?size=128`,
        body: message.content,
        attachments: message.attachments.length,
        richBody: null,
        permanent: false,
        onClick() { switchChannels(channel.guild_id, channel.id); }
    };

    if (message.embeds.length !== 0) {
        Notification.body = notificationText || "Sent an embed.";
    }

    // Message contains a sticker.
    if (message?.stickerItems) {
        Notification.body = notificationText || "Sent a sticker.";
    }

    // Message contains an attachment.
    if (message.attachments.length !== 0) {
        const images = message.attachments.filter(e => typeof e?.content_type === "string" && e?.content_type.startsWith("image"));
        // Label the notification with the attachment type.
        if (images.length !== 0) {
            Notification.body = notificationText || ""; // Dont show any body
            Notification.image = images[0].url;
        } else {
            Notification.body += ` [Attachment: ${message.attachments[0].filename}]`;
        }
    }

    // TODO: Format emotes properly.
    const matches = Notification.body.match(new RegExp("(<a?:\\w+:\\d+>)", "g"));
    if (matches) {
        for (const match of matches) {
            Notification.body = Notification.body.replace(new RegExp(`${match}`, "g"), `:${match.split(":")[1]}:`);
        }
    }

    // Replace any mention of users, roles and channels.
    if (message.mentions.length !== 0 || message.mentionRoles?.length > 0) {
        let lastIndex = 0;
        Notification.body.replace(USER_MENTION_REGEX, (match, userId, channelId, roleId, offset) => {
            richBodyElements.push(Notification.body.slice(lastIndex, offset));

            // Add the mention itself as a styled span.
            if (userId) {
                richBodyElements.push(addMention(userId, "user"));
            } else if (channelId) {
                richBodyElements.push(addMention(channelId, "channel"));
            } else if (roleId) {
                richBodyElements.push(addMention(roleId, "role", channel.guild_id));
            }

            lastIndex = offset + match.length;
            return match; // This value is not used but is necessary for the replace function
        });
    }

    if (richBodyElements.length > 0) {
        const MyRichBodyComponent = () => <>{richBodyElements}</>;
        Notification.richBody = <MyRichBodyComponent />;
    }

    Notification.body = limitMessageLength(Notification.body, Notification.attachments > 0);
    await showNotification(Notification);

}

async function relationshipAdd(user: User, type: Number) {
    user = UserStore.getUser(user.id);
    if (!settings.store.friendActivity) return;

    let notification: NotificationData = {
        title: "",
        icon: user.getAvatarURL(),
        body: "",
        attachments: 0,
    };

    if (type === RelationshipType.FRIEND) {
        notification.title = `${user.username} is now your friend`;
        notification.body = "You can now message them directly.";
        notification.onClick = () => switchChannels(null, user.id);


        await showNotification(notification);

    } else if (type === RelationshipType.INCOMING_REQUEST) {

        notification.title = `${user.username} sent you a friend request`;
        notification.body = "You can accept or decline it in the Friends tab.";
        notification.onClick = () => switchChannels(null, "");

        await showNotification(notification);
    }
}

/**
 * showExampleNotification()
 * Helper function to show an example notification.
 *
 * @returns {Promise<void>} A promise that resolves when the notification is shown.
 */
function showExampleNotification(): Promise<void> {
    return showNotification({
        title: "Example Notification",
        icon: `https://cdn.discordapp.com/avatars/${UserStore.getCurrentUser().id}/${UserStore.getCurrentUser().avatar}.png?size=128`,
        body: "This is an example toast notification!",
        attachments: 0,
        permanent: false
    });
}

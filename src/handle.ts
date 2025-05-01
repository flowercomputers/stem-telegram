import { getLastNMessages, storeMessage } from "./db/functions";
import { DrizzleD1 } from "./db";
import { answerCallbackQuery, sendMessage, sendTyping } from "./send";
import { AnthropicReply, CallbackQuery, ContextItem, Message, Update } from "./types";

export async function handleMessage(token: string, message: Message, claude_token: string, db?: D1Database) {

	const chat_id = message.chat.id;

	if (!message.text) return

	await sendTyping(token, chat_id);

	const typingInterval = setInterval(async () => {
		await sendTyping(token, chat_id);
	}, 4000);

	let context: ContextItem[] = [{ role: 'user', content: message.text }]

	// if the database is bound, save the received message
	if (db) {
		const recent6 = await getLastNMessages(chat_id, 6, db)
		context = recent6.reverse().map(a =>
		(
			{ role: a.username == 'bot' ? 'assistant' : 'user', content: a.text }
		))
		await storeMessage(message, db)
	}

	try {
		const response = await fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': claude_token,
				'anthropic-version': '2023-06-01'
			},
			body: JSON.stringify({
				model: "claude-3-5-sonnet-20241022",
				system: `You are a thoughtful, collaborative intellectual partner. Your role is to engage in constructive dialogue, help refine ideas, spot blindspots, and think things through together with me. Ask clarifying questions, but only when needed. Avoid writing code unless specifically asked for.

You have access to conversation history, so you can refer to previous messages in our chat. Feel free to reference earlier parts of our conversation when appropriate. You should maintain continuity in the conversation and remember details that were previously shared.`,
				max_tokens: 1024,
				temperature: 0.7,
				messages: context
			})
		});

		const data: AnthropicReply = await response.json();

		if (data && data.content[0].text) {
			clearInterval(typingInterval);
			await sendMessage(token, chat_id, data.content[0].text);

			// if the database is bound, save the sent message
			if (db) await storeMessage({
				...message,
				from: { ...message.from, id: 0, username: 'bot' },
				text: data.content[0].text  // Use the bot's response text here
			}, db)
		}

		else {
			throw new Error('No text returned from LLM!')
		}


	}

	catch (error: unknown) {
		clearInterval(typingInterval);
		sendMessage(token, chat_id, "Something went wrong: " + error)
		throw error;
	}
}



export async function handleCommand(token: string, message: Message, db?: D1Database) {
	const command = message.text!.split(' ')[0].substring(1);
	const chat_id = message.chat.id;

	let response = '';
	switch (command) {
		case 'start':
			response = 'Welcome! 👋\n What would you like to talk about?';
			await sendMessage(token, chat_id, response);
			break;

		case 'help':
			response = 'Available commands:\n' +
				'/start - Start the bot\n' +
				'/help - Show this help message';
			await sendMessage(token, chat_id, response);
			break;

		default:
			response = 'Unknown command';
			await sendMessage(token, chat_id, response);
			break;
	}

	// Store the bot's response in the database if available
	if (db && response) {
		await storeMessage({
			...message,
			from: { ...message.from, id: 0, username: 'bot' },
			text: response
		}, db);
	}
}


export async function handleCallback(token: string, query: CallbackQuery, db?: D1Database) {

	let response = '';
	switch (query.data) {
		case 'hello':
			response = 'You can start using me as a chatbot!';
			await sendMessage(token, query.message!.chat.id, response);
			break;
	}

	// Store the bot's response in the database if available
	if (db && response && query.message) {
		await storeMessage({
			...query.message,
			from: { ...query.from, id: 0, username: 'bot' },
			text: response
		}, db);
	}

	// Always answer callback query to remove loading state
	await answerCallbackQuery(token, query.id);
}
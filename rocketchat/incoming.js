class Script {
    process_incoming_request({ request }) {
        return {
            content: {
                text: request.content.text,
                channel: request.context.channel
            }
        };
    }
}


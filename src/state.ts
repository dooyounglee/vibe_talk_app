import { ref } from 'vue';

export const dmMessages = ref<Record<string, Message[]>>({});

interface Message {
  type: 'dm';
  from: string;
  to: string;
  text: string;
}

export function addDmMessage(message: Message) {
  const isOutgoing = message.from === 'self';
  const key = isOutgoing ? message.to : message.from;
  
  if (dmMessages.value[key]) {
    dmMessages.value[key].push(message);
  } else {
    dmMessages.value[key] = [message];
  }
}
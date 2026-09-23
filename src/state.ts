import { ref } from 'vue';

export const dmMessages = ref<Record<string, Array<{ type: string; nickname: string; text: string }>>>({}); 

interface Message {
  type: 'dm';
  nickname: string;
  to: string;
  text: string;
}

export function addDmMessage(message: Message) {
  const isOutgoing = message.nickname === 'self';
  const key = isOutgoing ? message.to : message.nickname;
  
  if (dmMessages.value[key]) {
    dmMessages.value[key].push(message);
  } else {
    dmMessages.value[key] = [message];
  }
}
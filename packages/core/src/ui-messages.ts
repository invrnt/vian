/** Bot-owned interface copy, independent of model response language. */
export const uiMessages = {
  es: { working: 'Trabajando', done: 'Hecho', noResponse: 'Sin Respuesta', failed: 'No se pudo completar la solicitud. Inténtalo de nuevo.', cancelled: 'Generación detenida.', deliveryFailed: 'No se pudo entregar la respuesta.', deliveryUnknown: 'No se pudo confirmar la entrega de la respuesta.' },
  en: { working: 'Working', done: 'Done', noResponse: 'No Response', failed: 'The request could not be completed. Please try again.', cancelled: 'Generation stopped.', deliveryFailed: 'The response could not be delivered.', deliveryUnknown: 'The response delivery could not be confirmed.' },
} as const;
export type UiLanguage = keyof typeof uiMessages;

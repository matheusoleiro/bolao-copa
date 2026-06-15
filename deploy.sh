#!/bin/bash
# Roda os testes locais e, se passarem, faz o deploy do Firebase Hosting.
# Se algum teste falhar, NÃO faz deploy.
#
# Uso:
#   ./deploy.sh
#
# Requisitos: Node 18+, firebase-tools instalado e logado (firebase login).

set -e  # qualquer erro encontrado interrompe o script imediatamente

echo "🧪 Rodando testes..."
echo ""

if node --test bolao-tests.test.mjs; then
  echo ""
  echo "✅ Testes passaram! Fazendo deploy..."
  echo ""
  firebase deploy --only hosting
  echo ""
  echo "🚀 Deploy concluído!"
else
  echo ""
  echo "❌ Testes FALHARAM. Deploy cancelado."
  echo "   Corrija os erros acima antes de tentar de novo."
  exit 1
fi
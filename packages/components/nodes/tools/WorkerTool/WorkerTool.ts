import { INode, INodeData, INodeParams } from '../../../src/Interface'
import { getBaseClasses } from '../../../src/utils'
import { WorkerTool, WorkerToolParams } from './core'

class WorkerToolNode implements INode {
    label: string
    name: string
    version: number
    description: string
    type: string
    icon: string
    category: string
    baseClasses: string[]
    inputs: INodeParams[]

    constructor() {
        this.label = 'Claude Worker Tool'
        this.name = 'workerTool'
        this.version = 1.0
        this.type = 'WorkerTool'
        this.icon = 'worker.svg'
        this.category = 'Tools'
        this.description = 'Execute coding tasks using Claude Worker'
        this.baseClasses = [this.type, ...getBaseClasses(WorkerTool), 'Tool']
        this.inputs = [
            {
                label: 'Worker URL',
                name: 'workerUrl',
                type: 'string',
                default: 'http://localhost:3001',
                description: 'URL of the Claude Worker service',
            },
            {
                label: 'Worker Role',
                name: 'workerRole',
                type: 'options',
                options: [
                    { label: 'Coding', name: 'coding' },
                    { label: 'Support', name: 'support' },
                ],
                default: 'coding',
                description: 'Role of the worker (coding or support)',
            },
            {
                label: 'Max Concurrency',
                name: 'maxConcurrency',
                type: 'number',
                default: 2,
                optional: true,
                description: 'Maximum number of concurrent jobs',
            },
        ]
    }

    async init(nodeData: INodeData): Promise<any> {
        const workerUrl = (nodeData.inputs?.workerUrl as string) || 'http://localhost:3001'
        const workerRole = (nodeData.inputs?.workerRole as string) || 'coding'
        const maxConcurrency = (nodeData.inputs?.maxConcurrency as number) || 2

        const params: WorkerToolParams = {
            workerUrl,
            workerRole,
            maxConcurrency,
        }

        return new WorkerTool(params)
    }
}

module.exports = { nodeClass: WorkerToolNode }
